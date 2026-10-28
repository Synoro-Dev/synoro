import { logger } from "@synoro/config";
import {
  and,
  eq,
  Payment,
  PaymentAccount,
  PaymentPackage,
  PracticeMember,
} from "@synoro/db";
import { formatCredits, professionTerms } from "@synoro/validators";
import { z } from "zod";

import {
  credentialsOf,
  gateways,
  notificationUrl,
  ProviderError,
  returnUrl,
  secretsAvailable,
} from "../../lib/payments";
import {
  findMembership,
  findPractice,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Start paying for a package of credits. The caller becomes a client
 * of the practice if they weren't one yet. Returns the provider's payment
 * page to redirect to; afterwards the client lands on their cabinet, which
 * checks the payment (`payment.status`) — the webhook settles it too.
 *
 * @example const { confirmationUrl } = await client.payment.checkout({ practiceId, packageId })
 */
export const checkout = practiceProcedure
  .errors({
    NOT_FOUND: { message: "Пакет не найден — обновите страницу" },
    PAYMENTS_DISABLED: {
      message: "Специалист пока не принимает оплату онлайн",
    },
    PROVIDER_ERROR: {
      message: "Платёжная система не приняла платёж, попробуйте позже",
    },
  })
  .input(z.object({ practiceId: z.uuid(), packageId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const practice = await findPractice(context.db, input.practiceId);
    if (!practice) throw errors.FORBIDDEN();

    await context.db
      .insert(PracticeMember)
      .values({ practiceId: practice.id, userId: user.id, role: "client" })
      .onConflictDoNothing();
    const member = await findMembership(context.db, practice.id, user.id);
    // Staff have no balance to top up.
    if (member?.role !== "client") throw errors.FORBIDDEN();

    const [account, pkg] = await Promise.all([
      context.db.query.PaymentAccount.findFirst({
        where: and(
          eq(PaymentAccount.practiceId, practice.id),
          eq(PaymentAccount.active, true),
        ),
      }),
      context.db.query.PaymentPackage.findFirst({
        where: and(
          eq(PaymentPackage.id, input.packageId),
          eq(PaymentPackage.practiceId, practice.id),
        ),
      }),
    ]);
    if (!account || !secretsAvailable()) throw errors.PAYMENTS_DISABLED();
    if (!pkg) throw errors.NOT_FOUND();

    const [payment] = await context.db
      .insert(Payment)
      .values({
        practiceId: practice.id,
        accountId: account.id,
        memberId: member.id,
        provider: account.provider,
        credits: pkg.credits,
        amount: pkg.price,
        createdById: user.id,
      })
      .returning();
    if (!payment) throw new Error("Failed to insert payment");

    const terms = professionTerms(practice.profession);
    const item = `${formatCredits(pkg.credits, terms)} — ${practice.name}`;
    let remote: Awaited<ReturnType<(typeof gateways)["yookassa"]["create"]>>;
    try {
      remote = await gateways[account.provider].create(credentialsOf(account), {
        orderId: payment.id,
        amount: pkg.price,
        description: `Оплата: ${item}`,
        returnUrl: returnUrl(payment.id),
        notificationUrl: notificationUrl(account.provider),
        email: user.email,
        receipt: account.receipts
          ? {
              itemName: `Пакет: ${item}`,
              taxSystem: account.taxSystem,
            }
          : undefined,
      });
    } catch (error) {
      // Nothing was charged: drop the attempt instead of keeping a dead row.
      await context.db.delete(Payment).where(eq(Payment.id, payment.id));
      if (!(error instanceof ProviderError)) throw error;
      logger.warn("payment.create_failed", {
        practiceId: practice.id,
        provider: account.provider,
        kind: error.kind,
        error: error.message,
      });
      throw errors.PROVIDER_ERROR({
        message:
          error.kind === "credentials"
            ? "Оплата у специалиста временно не работает — сообщите ему, пожалуйста"
            : error.kind === "rejected"
              ? error.message
              : undefined,
        cause: error,
      });
    }

    if (!remote.confirmationUrl) {
      await context.db.delete(Payment).where(eq(Payment.id, payment.id));
      throw errors.PROVIDER_ERROR();
    }

    await context.db
      .update(Payment)
      .set({
        externalId: remote.externalId,
        confirmationUrl: remote.confirmationUrl,
      })
      .where(eq(Payment.id, payment.id));

    return { paymentId: payment.id, confirmationUrl: remote.confirmationUrl };
  });

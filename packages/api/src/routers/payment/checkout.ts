import { logger } from "@synoro/config";
import {
  and,
  eq,
  PaymentAccount,
  PaymentPackage,
  PracticeMember,
} from "@synoro/db";
import { z } from "zod";

import {
  canTakePayments,
  ProviderError,
  providerFailureMessage,
  returnUrl,
  startPayment,
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
    if (!account || !canTakePayments(account)) throw errors.PAYMENTS_DISABLED();
    if (!pkg) throw errors.NOT_FOUND();

    try {
      return await startPayment(context.db, {
        practice,
        account,
        pkg,
        memberId: member.id,
        user,
        returnUrl,
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      logger.warn("payment.create_failed", {
        practiceId: practice.id,
        provider: account.provider,
        kind: error.kind,
        error: error.message,
      });
      throw errors.PROVIDER_ERROR({
        message: providerFailureMessage(error),
        cause: error,
      });
    }
  });

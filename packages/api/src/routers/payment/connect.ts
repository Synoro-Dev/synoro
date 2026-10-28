import { and, eq, ne, PaymentAccount } from "@synoro/db";
import { paymentAccountFormSchema } from "@synoro/validators";
import { z } from "zod";
import { hasPro } from "../../lib/billing";
import {
  credentialsOf,
  encryptSecret,
  gateways,
  ProviderError,
  secretsAvailable,
} from "../../lib/payments";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure, paymentSettings } from "./owner";

/**
 * Connect ЮKassa or Т-Банк (or update the connected one) — «Про» only. The key pair is
 * checked with the provider before it is saved, encrypted. Connecting a
 * provider switches the practice to it; the other one's keys are kept,
 * inactive, so payments started with it still settle.
 *
 * @example client.payment.connect({ practiceId, provider: "yookassa", merchantId: "123456", secret: "live_…", receipts: false, taxSystem: null })
 */
export const connect = ownerProcedure
  .errors({
    PLAN_REQUIRED: {
      message: "Доступно на тарифе «Про» — оплатите его в настройках",
    },
    PAYMENTS_UNAVAILABLE: {
      message: "Онлайн-оплата не настроена на сервере (PAYMENTS_SECRET_KEY)",
    },
    SECRET_REQUIRED: { message: "Введите секретный ключ" },
    INVALID_CREDENTIALS: {
      message: "Платёжная система не приняла данные магазина",
    },
    PROVIDER_UNAVAILABLE: {
      message: "Платёжная система не отвечает, попробуйте позже",
    },
  })
  .input(
    z.intersection(
      paymentAccountFormSchema,
      z.object({ practiceId: z.uuid() }),
    ),
  )
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();
    if (!(await hasPro(context.db, context.session.user.id))) {
      throw errors.PLAN_REQUIRED();
    }
    if (!secretsAvailable()) throw errors.PAYMENTS_UNAVAILABLE();

    const saved = await context.db.query.PaymentAccount.findFirst({
      where: and(
        eq(PaymentAccount.practiceId, input.practiceId),
        eq(PaymentAccount.provider, input.provider),
      ),
    });
    // An empty secret keeps the saved one, but only for the same merchant.
    const secret =
      input.secret ||
      (saved?.merchantId === input.merchantId
        ? credentialsOf(saved).secret
        : undefined);
    if (!secret) throw errors.SECRET_REQUIRED();

    let test: boolean;
    try {
      ({ test } = await gateways[input.provider].verify({
        merchantId: input.merchantId,
        secret,
      }));
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (error.kind === "unavailable") {
        throw errors.PROVIDER_UNAVAILABLE({ cause: error });
      }
      throw errors.INVALID_CREDENTIALS({
        message: error.message,
        cause: error,
      });
    }

    // One active account per practice (partial unique index): switch the
    // other provider off before this one goes on.
    await context.db
      .update(PaymentAccount)
      .set({ active: false })
      .where(
        and(
          eq(PaymentAccount.practiceId, input.practiceId),
          ne(PaymentAccount.provider, input.provider),
        ),
      );

    const values = {
      merchantId: input.merchantId,
      secret: encryptSecret(secret),
      test,
      active: true,
      receipts: input.receipts,
      taxSystem: input.taxSystem,
    };
    await context.db
      .insert(PaymentAccount)
      .values({
        practiceId: input.practiceId,
        provider: input.provider,
        ...values,
      })
      .onConflictDoUpdate({
        target: [PaymentAccount.practiceId, PaymentAccount.provider],
        set: values,
      });

    return paymentSettings(context.db, input.practiceId);
  });

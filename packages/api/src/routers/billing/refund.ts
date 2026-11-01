import { logger } from "@synoro/config";
import { z } from "zod";

import { refundSubscriptionPayment } from "../../lib/billing";
import { ProviderError } from "../../lib/payments";
import { adminProcedure } from "../../orpc";

/**
 * Give a specialist's «Про» payment back in full: Точка returns the money and
 * the paid period comes off `paid_until`. Only the newest paid period can be
 * refunded; for several, go from the last one backwards. Also switches the
 * specialist's auto-renewal off. Payments made through a subscription (the
 * first one and automatic charges) are refunded in the internet bank, then
 * recorded here with `recorded: true`.
 *
 * @example await client.billing.refund({ paymentId })
 */
export const refund = adminProcedure
  .errors({
    NOT_FOUND: { message: "Платёж не найден" },
    NOT_REFUNDABLE: {
      message:
        "Этот платёж нельзя вернуть: он не оплачен, уже возвращён или тестовый",
    },
    BANK_ONLY: {
      message:
        "Платёж по подписке возвращается только в интернет-банке: верните его там и повторите с recorded",
    },
    NOT_LATEST: {
      message: "Сначала верните более поздний платёж этого специалиста",
    },
    PROVIDER_ERROR: {
      message: "Банк не вернул платёж, попробуйте позже",
    },
  })
  .input(
    z.object({
      paymentId: z.uuid(),
      /** The money has been returned in the internet bank already. */
      recorded: z.boolean().default(false),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    try {
      const outcome = await refundSubscriptionPayment(
        context.db,
        input.paymentId,
        { recorded: input.recorded },
      );
      switch (outcome.result) {
        case "not_found":
          throw errors.NOT_FOUND();
        case "not_refundable":
          throw errors.NOT_REFUNDABLE();
        case "bank_only":
          throw errors.BANK_ONLY();
        case "not_latest":
          throw errors.NOT_LATEST();
        case "refunded":
          return {
            id: outcome.payment.id,
            refundedAt: outcome.payment.refundedAt,
          };
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      logger.error("billing.refund_failed", error, {
        paymentId: input.paymentId,
        kind: error.kind,
      });
      throw errors.PROVIDER_ERROR({ cause: error });
    }
  });

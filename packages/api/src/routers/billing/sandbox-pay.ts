import { z } from "zod";

import { settleSandboxPayment } from "../../lib/billing";
import { protectedProcedure } from "../../orpc";

/**
 * Sandbox only (`TOCHKA_SANDBOX`): play the bank for a pending «Про» payment
 * of the caller — pay it or decline it. Точка's sandbox links can't be paid,
 * so this stands in for the payment page; settling is the real code path.
 *
 * @example await client.billing.sandboxPay({ paymentId, outcome: "succeeded" })
 */
export const sandboxPay = protectedProcedure
  .errors({ NOT_FOUND: { message: "Тестовый платёж не найден" } })
  .input(
    z.object({
      paymentId: z.uuid(),
      outcome: z.enum(["succeeded", "canceled"]),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const payment = await settleSandboxPayment(context.db, {
      userId: context.session.user.id,
      ...input,
    });
    if (!payment) throw errors.NOT_FOUND();
    return { id: payment.id, status: payment.status };
  });

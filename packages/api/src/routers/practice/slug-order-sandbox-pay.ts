import { z } from "zod";

import { settleSandboxSlugOrder } from "../../lib/billing/slug-orders";
import { protectedProcedure } from "../../orpc";

/**
 * Sandbox only (`TOCHKA_SANDBOX`): play the bank for a pending address order
 * of the caller, as `billing.sandboxPay` does for «Про».
 *
 * @example await client.practice.slugOrderSandboxPay({ orderId, outcome: "succeeded" })
 */
export const slugOrderSandboxPay = protectedProcedure
  .errors({ NOT_FOUND: { message: "Тестовый заказ не найден" } })
  .input(
    z.object({
      orderId: z.uuid(),
      outcome: z.enum(["succeeded", "canceled"]),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const order = await settleSandboxSlugOrder(context.db, {
      userId: context.session.user.id,
      ...input,
    });
    if (!order) throw errors.NOT_FOUND();
    return { id: order.id, status: order.status };
  });

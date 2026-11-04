import { and, eq, SlugOrder } from "@synoro/db";
import { z } from "zod";

import { isSandboxPayment } from "../../lib/billing";
import { syncSlugOrder } from "../../lib/billing/slug-orders";
import { protectedProcedure } from "../../orpc";

/**
 * An address order of the caller, checked with the bank first when pending,
 * so the page settings show the result right after the redirect back.
 *
 * @example client.practice.slugOrder({ orderId })
 */
export const slugOrder = protectedProcedure
  .errors({ NOT_FOUND: { message: "Заказ не найден" } })
  .input(z.object({ orderId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const found = await context.db.query.SlugOrder.findFirst({
      where: and(
        eq(SlugOrder.id, input.orderId),
        eq(SlugOrder.userId, context.session.user.id),
      ),
    });
    if (!found) throw errors.NOT_FOUND();

    const order = await syncSlugOrder(context.db, found);
    return {
      id: order.id,
      slug: order.slug,
      status: order.status,
      amount: order.amount,
      confirmationUrl: order.confirmationUrl,
      /** Opened in Точка's sandbox: confirmed by `practice.slugOrderSandboxPay`. */
      sandbox: isSandboxPayment(order),
    };
  });

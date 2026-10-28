import { and, eq, SubscriptionPayment } from "@synoro/db";
import { z } from "zod";

import {
  findSubscription,
  planOf,
  syncSubscriptionPayment,
} from "../../lib/billing";
import { protectedProcedure } from "../../orpc";

/**
 * A «Про» payment of the caller, checked with the bank first when pending,
 * so the billing page shows the result right after the redirect back.
 *
 * @example client.billing.status({ paymentId })
 */
export const status = protectedProcedure
  .errors({ NOT_FOUND: { message: "Платёж не найден" } })
  .input(z.object({ paymentId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const found = await context.db.query.SubscriptionPayment.findFirst({
      where: and(
        eq(SubscriptionPayment.id, input.paymentId),
        eq(SubscriptionPayment.userId, userId),
      ),
    });
    if (!found) throw errors.NOT_FOUND();

    const payment = await syncSubscriptionPayment(context.db, found);
    return {
      id: payment.id,
      status: payment.status,
      period: payment.period,
      amount: payment.amount,
      confirmationUrl: payment.confirmationUrl,
      plan: planOf(await findSubscription(context.db, userId)),
    };
  });

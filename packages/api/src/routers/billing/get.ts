import { desc, eq, SubscriptionPayment } from "@synoro/db";
import { PRO_PRICES } from "@synoro/validators";

import { billingAvailable, findSubscription, planOf } from "../../lib/billing";
import { protectedProcedure } from "../../orpc";

/**
 * The caller's «Про» plan: trial / paid period, prices, whether it can be
 * paid for here, and the last payments.
 *
 * @example const { plan, prices } = await client.billing.get()
 */
export const get = protectedProcedure.handler(async ({ context }) => {
  const userId = context.session.user.id;
  const [subscription, payments] = await Promise.all([
    findSubscription(context.db, userId),
    context.db
      .select({
        id: SubscriptionPayment.id,
        period: SubscriptionPayment.period,
        amount: SubscriptionPayment.amount,
        status: SubscriptionPayment.status,
        periodEnd: SubscriptionPayment.periodEnd,
        paidAt: SubscriptionPayment.paidAt,
        createdAt: SubscriptionPayment.createdAt,
      })
      .from(SubscriptionPayment)
      .where(eq(SubscriptionPayment.userId, userId))
      .orderBy(desc(SubscriptionPayment.createdAt))
      .limit(20),
  ]);

  return {
    plan: planOf(subscription),
    prices: PRO_PRICES,
    available: billingAvailable(),
    // Abandoned links stay pending until they expire: show paid ones only.
    payments: payments.filter((p) => p.status === "succeeded"),
  };
});

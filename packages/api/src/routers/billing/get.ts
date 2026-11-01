import { and, desc, eq, SubscriptionPayment } from "@synoro/db";
import { PRO_PRICES } from "@synoro/validators";

import {
  billingAvailable,
  findActiveAutorenewal,
  findSubscription,
  planOf,
  tochkaSandbox,
} from "../../lib/billing";
import { protectedProcedure } from "../../orpc";

/**
 * The caller's «Про» plan: trial / paid period, auto-renewal, prices, whether
 * it can be paid for here, and the last payments.
 *
 * @example const { plan, prices } = await client.billing.get()
 */
export const get = protectedProcedure.handler(async ({ context }) => {
  const userId = context.session.user.id;
  const [subscription, autorenewal, payments] = await Promise.all([
    findSubscription(context.db, userId),
    findActiveAutorenewal(context.db, userId),
    context.db
      .select({
        id: SubscriptionPayment.id,
        period: SubscriptionPayment.period,
        amount: SubscriptionPayment.amount,
        status: SubscriptionPayment.status,
        periodEnd: SubscriptionPayment.periodEnd,
        paidAt: SubscriptionPayment.paidAt,
        refundedAt: SubscriptionPayment.refundedAt,
        createdAt: SubscriptionPayment.createdAt,
      })
      .from(SubscriptionPayment)
      .where(
        and(
          eq(SubscriptionPayment.userId, userId),
          eq(SubscriptionPayment.status, "succeeded"),
        ),
      )
      .orderBy(desc(SubscriptionPayment.createdAt))
      .limit(20),
  ]);

  return {
    plan: planOf(subscription),
    /** Auto-renewal on: the card is charged for `period` before the end. */
    autorenew: autorenewal
      ? {
          period: autorenewal.period,
          amount: PRO_PRICES[autorenewal.period].amount,
          consentAt: autorenewal.consentAt,
        }
      : null,
    prices: PRO_PRICES,
    available: billingAvailable(),
    /** Payments go to Точка's sandbox: nothing is charged. */
    sandbox: tochkaSandbox(),
    payments,
  };
});

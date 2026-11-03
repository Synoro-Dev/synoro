import {
  Booking,
  Practice,
  Subscription,
  SubscriptionPayment,
  sql,
  user,
} from "@synoro/db";

import { adminProcedure } from "../../../orpc";

/**
 * The platform at a glance for admin.synoro.ru: people, practices, «Про»
 * and what it brought in. One aggregate per table, counted in Postgres.
 *
 * Revenue is «Про» payments that succeeded and weren't refunded, in kopecks.
 *
 * @example client.admin.stats.overview()
 */
export const overview = adminProcedure.handler(async ({ context }) => {
  const [users] = await context.db
    .select({
      total: sql<number>`count(*)::int`,
      week: sql<number>`(count(*) filter (where ${user.createdAt} > now() - interval '7 days'))::int`,
      month: sql<number>`(count(*) filter (where ${user.createdAt} > now() - interval '30 days'))::int`,
    })
    .from(user);

  const [practices] = await context.db
    .select({
      total: sql<number>`count(*)::int`,
      month: sql<number>`(count(*) filter (where ${Practice.createdAt} > now() - interval '30 days'))::int`,
    })
    .from(Practice);

  const [plans] = await context.db
    .select({
      paying: sql<number>`(count(*) filter (where ${Subscription.paidUntil} > now()))::int`,
      trial: sql<number>`(count(*) filter (where ${Subscription.trialEndsAt} > now() and (${Subscription.paidUntil} is null or ${Subscription.paidUntil} <= now())))::int`,
    })
    .from(Subscription);

  const [revenue] = await context.db
    .select({
      month: sql<number>`coalesce(sum(${SubscriptionPayment.amount}) filter (where ${SubscriptionPayment.paidAt} > now() - interval '30 days'), 0)::int`,
      total: sql<number>`coalesce(sum(${SubscriptionPayment.amount}), 0)::int`,
      payments: sql<number>`count(*)::int`,
    })
    .from(SubscriptionPayment)
    .where(
      sql`${SubscriptionPayment.status} = 'succeeded' and ${SubscriptionPayment.refundedAt} is null`,
    );

  const [bookings] = await context.db
    .select({
      month: sql<number>`count(*)::int`,
    })
    .from(Booking)
    .where(sql`${Booking.createdAt} > now() - interval '30 days'`);

  return {
    users: {
      total: users?.total ?? 0,
      week: users?.week ?? 0,
      month: users?.month ?? 0,
    },
    practices: {
      total: practices?.total ?? 0,
      month: practices?.month ?? 0,
    },
    pro: { paying: plans?.paying ?? 0, trial: plans?.trial ?? 0 },
    revenue: {
      month: revenue?.month ?? 0,
      total: revenue?.total ?? 0,
      payments: revenue?.payments ?? 0,
    },
    bookings: { month: bookings?.month ?? 0 },
  };
});

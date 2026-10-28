import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { paymentStatus } from "../payment/payment";

/**
 * The specialist's «Про» plan on Synoro: one row per user, created with
 * their first practice (that starts the trial). «Про» is on while
 * `now()` is before `trialEndsAt` or `paidUntil`; after both it falls back
 * to the free plan. No auto-renewal: each paid period is bought up front.
 */
export const Subscription = pgTable("subscriptions", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  trialEndsAt: t.timestamp({ withTimezone: true }).notNull(),
  /** End of the last paid period; null until the first payment. */
  paidUntil: t.timestamp({ withTimezone: true }),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

/** What one payment buys: a month or a year of «Про». */
export const billingPeriod = pgEnum("billing_period", ["month", "year"]);

/**
 * A specialist paying Synoro for «Про» through the platform's Точка Банк
 * acquiring (not the practice's own merchant account). Same lifecycle as
 * `payments`: the bank is the source of truth, and the move to `succeeded`
 * extends `subscriptions.paid_until` in the same statement, once.
 */
export const SubscriptionPayment = pgTable(
  "subscription_payments",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    period: billingPeriod().notNull(),
    /** Kopecks, RUB. */
    amount: t.integer().notNull(),
    status: paymentStatus().notNull().default("pending"),
    /** Точка's `operationId`; set once the bank created the payment link. */
    externalId: t.varchar({ length: 64 }).unique(),
    /** The bank's payment page, while the payment is pending. */
    confirmationUrl: t.text(),
    /** The paid period, set on success. */
    periodStart: t.timestamp({ withTimezone: true }),
    periodEnd: t.timestamp({ withTimezone: true }),
    paidAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("subscription_payments_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    check("subscription_payments_positive", sql`${table.amount} > 0`),
  ],
);

export type BillingPeriod = (typeof billingPeriod.enumValues)[number];

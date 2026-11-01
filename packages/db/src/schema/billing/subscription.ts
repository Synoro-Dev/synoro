import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { paymentStatus } from "../payment/payment";

/**
 * The specialist's «Про» plan on Synoro: one row per user, created with
 * their first practice (that starts the trial). «Про» is on while
 * `now()` is before `trialEndsAt` or `paidUntil`; after both it falls back
 * to the free plan. Each paid period is bought up front, by hand or by the
 * auto-renewal (`SubscriptionAutorenewal`) the specialist agreed to.
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
    /**
     * When the whole payment went back to the customer (`billing.refund`).
     * The status stays `succeeded`; the paid period is taken off
     * `subscriptions.paid_until` in the same statement.
     */
    refundedAt: t.timestamp({ withTimezone: true }),
    /**
     * Set when the specialist agreed to auto-renewal while paying: this
     * payment opened a Точка subscription (`externalId` is the subscription's
     * `operationId`) and, once paid, turns auto-renewal on.
     */
    autorenewConsentAt: t.timestamp({ withTimezone: true }),
    /**
     * Set on a payment made by auto-renewal: the `paid_until` it renews. At
     * most one per user and value, so two workers can never charge one
     * period twice; a declined attempt clears it to allow a retry.
     */
    chargedFor: t.timestamp({ withTimezone: true }),
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
    uniqueIndex("subscription_payments_user_charged_for_idx").on(
      table.userId,
      table.chargedFor,
    ),
  ],
);

export const autorenewalStatus = pgEnum("autorenewal_status", [
  "active",
  "canceled",
]);

/**
 * user          — the specialist turned it off;
 * refund        — a payment was refunded (`billing.refund`);
 * charge_failed — the bank declined the charge on every attempt.
 */
export const autorenewalCancelReason = pgEnum("autorenewal_cancel_reason", [
  "user",
  "refund",
  "charge_failed",
]);

/**
 * Auto-renewal of «Про»: a Точка subscription without a schedule
 * (`recurring: true`) that holds the specialist's card. The `billing-renewals`
 * cron charges it for a new period shortly before `paid_until`; the amount
 * and the dates are ours, the bank only moves the money. One row per user:
 * agreeing again replaces the subscription. A schedule-less subscription
 * can't be cancelled through the bank's API, so "canceled" only means that
 * we stop charging.
 */
export const SubscriptionAutorenewal = pgTable(
  "subscription_autorenewals",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Точка's subscription `operationId` (the first payment's id). */
    externalId: t.varchar({ length: 64 }).notNull().unique(),
    /** What each charge buys. */
    period: billingPeriod().notNull(),
    status: autorenewalStatus().notNull().default("active"),
    /** When the specialist agreed (the checkbox on the payment form). */
    consentAt: t.timestamp({ withTimezone: true }).notNull(),
    /** Declined charges in a row; reset by a successful one. */
    failedAttempts: t.integer().notNull().default(0),
    lastAttemptAt: t.timestamp({ withTimezone: true }),
    canceledAt: t.timestamp({ withTimezone: true }),
    cancelReason: autorenewalCancelReason(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [index("subscription_autorenewals_status_idx").on(table.status)],
);

export type BillingPeriod = (typeof billingPeriod.enumValues)[number];
export type AutorenewalCancelReason =
  (typeof autorenewalCancelReason.enumValues)[number];

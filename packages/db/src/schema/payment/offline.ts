import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Booking } from "../booking/booking";
import { CreditEntry } from "../booking/credit";
import { Practice, PracticeMember } from "../booking/practice";

/** Keep in sync with `OFFLINE_PAYMENT_METHODS` in `@synoro/validators`. */
export const offlinePaymentMethod = pgEnum("offline_payment_method", [
  "cash",
  "transfer",
  "card",
  "other",
]);

/**
 * Money a client paid the specialist outside Synoro — cash, a transfer —
 * as staff wrote it down. It moves no balance by itself: a package paid this
 * way is credited by `credit.grant`, which links its entry here
 * (`creditEntryId`); a booking paid at the visit is marked paid by
 * `bookingId`. Counted with online payments as the practice's income.
 */
export const OfflinePayment = pgTable(
  "offline_payments",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    /** Who paid; null once they left the practice. */
    memberId: t
      .uuid()
      .references(() => PracticeMember.id, { onDelete: "set null" }),
    /** The booking it pays for, when it was paid at the visit. */
    bookingId: t.uuid().references(() => Booking.id, { onDelete: "set null" }),
    /** The balance entry of a package it paid for (`credit.grant`). */
    creditEntryId: t
      .uuid()
      .references(() => CreditEntry.id, { onDelete: "set null" }),
    /** Kopecks. */
    amount: t.integer().notNull(),
    method: offlinePaymentMethod().notNull(),
    /** When the money came, as staff said. */
    paidAt: t.timestamp({ withTimezone: true }).notNull(),
    note: t.varchar({ length: 500 }),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("offline_payments_practice_paid_idx").on(
      table.practiceId,
      table.paidAt,
    ),
    index("offline_payments_booking_idx").on(table.bookingId),
    check(
      "offline_payments_amount_range",
      sql`${table.amount} between 1 and 100000000`,
    ),
  ],
);

export type OfflinePaymentMethod =
  (typeof offlinePaymentMethod.enumValues)[number];

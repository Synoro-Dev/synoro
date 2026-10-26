import { index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Booking } from "./booking";
import { PracticeMember } from "./practice";

/**
 * purchase   — administrator recorded paid consultations (+N).
 * booking    — a client booked an hour (−1).
 * refund     — a booking was cancelled in time (+1).
 * adjustment — manual correction by staff (±N).
 */
export const creditReason = pgEnum("credit_reason", [
  "purchase",
  "booking",
  "refund",
  "adjustment",
]);

/**
 * History of every change to `PracticeMember.credits`. The balance itself
 * lives on the member row (updated atomically); this is the audit trail.
 */
export const CreditEntry = pgTable(
  "credit_entries",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    memberId: t
      .uuid()
      .notNull()
      .references(() => PracticeMember.id, { onDelete: "cascade" }),
    delta: t.integer().notNull(),
    reason: creditReason().notNull(),
    bookingId: t.uuid().references(() => Booking.id, { onDelete: "set null" }),
    note: t.varchar({ length: 500 }),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [index("credit_entries_member_idx").on(table.memberId)],
);

import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice, PracticeMember } from "./practice";

/**
 * consultation — paid, 1 hour, booked by a client for one credit.
 * free         — free, 30 minutes, booked by staff for a guest (name + contact).
 * blocked      — time the specialist closed for themselves; nobody can book it.
 */
export const bookingKind = pgEnum("booking_kind", [
  "consultation",
  "free",
  "blocked",
]);

export const bookingStatus = pgEnum("booking_status", ["active", "cancelled"]);

/**
 * Overlapping active bookings of one practice are rejected by the
 * `bookings_no_overlap` exclusion constraint (btree_gist), added by hand in
 * the migration: drizzle-kit can't express EXCLUDE. That is what guarantees
 * one client per time slot, even for concurrent requests.
 */
export const Booking = pgTable(
  "bookings",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    kind: bookingKind().notNull(),
    status: bookingStatus().notNull().default("active"),
    startsAt: t.timestamp({ withTimezone: true }).notNull(),
    endsAt: t.timestamp({ withTimezone: true }).notNull(),
    /** The client of a paid consultation. */
    memberId: t
      .uuid()
      .references(() => PracticeMember.id, { onDelete: "set null" }),
    /** Who a free consultation is for (not necessarily a registered user). */
    guestName: t.varchar({ length: 120 }),
    guestContact: t.varchar({ length: 120 }),
    note: t.varchar({ length: 500 }),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    cancelledAt: t.timestamp({ withTimezone: true }),
    cancelledById: t.text().references(() => user.id, { onDelete: "set null" }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("bookings_practice_starts_idx").on(table.practiceId, table.startsAt),
    index("bookings_member_idx").on(table.memberId),
    check("bookings_valid_range", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

export type BookingKind = (typeof bookingKind.enumValues)[number];

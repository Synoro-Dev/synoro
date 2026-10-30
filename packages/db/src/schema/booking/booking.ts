import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, unique } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice, PracticeMember } from "./practice";
import { BookingSeries } from "./series";

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
 * Why a booking was cancelled; set together with `status = 'cancelled'`.
 *
 * client            — the client cancelled it (signed in or by their link).
 * staff             — the owner or an administrator cancelled it.
 * no_show           — the client didn't come: staff marked a started booking,
 *                     the consultation is not given back.
 * hold_expired      — an online booking wasn't paid within the hold.
 * payment_cancelled — the payment of an online booking was cancelled.
 */
export const bookingCancelReason = pgEnum("booking_cancel_reason", [
  "client",
  "staff",
  "no_show",
  "hold_expired",
  "payment_cancelled",
]);

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
    /** E.164, required for new free bookings (older rows have none). */
    guestPhone: t.varchar({ length: 20 }),
    /** Any other way to reach the guest: Telegram, email. */
    guestContact: t.varchar({ length: 120 }),
    note: t.varchar({ length: 500 }),
    /** The recurring booking this one belongs to (`booking_series`). */
    seriesId: t
      .uuid()
      .references(() => BookingSeries.id, { onDelete: "set null" }),
    /**
     * Video room of this booking only; falls back to `practices.video_url`.
     * Shown to the client once the booking is confirmed.
     */
    meetingUrl: t.text(),
    /** When the 24-hour / 1-hour reminders with the link went out. */
    reminderDaySentAt: t.timestamp({ withTimezone: true }),
    reminderHourSentAt: t.timestamp({ withTimezone: true }),
    /** The event mirroring this booking in the specialist's Google Calendar. */
    googleCalendarId: t.text(),
    googleEventId: t.text(),
    /**
     * Set while the guest's online payment is awaited: the booking is
     * `active` (so it holds the time) but unpaid, and stops holding it when
     * this passes. Null once paid, and always for bookings not made online.
     */
    holdUntil: t.timestamp({ withTimezone: true }),
    /**
     * SHA-256 of the secret in the guest's `/b/<token>` link; the token itself
     * is never stored.
     */
    accessTokenHash: t.varchar({ length: 64 }),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    cancelledAt: t.timestamp({ withTimezone: true }),
    cancelledById: t.text().references(() => user.id, { onDelete: "set null" }),
    cancelReason: bookingCancelReason(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("bookings_practice_starts_idx").on(table.practiceId, table.startsAt),
    index("bookings_member_idx").on(table.memberId),
    index("bookings_series_idx").on(table.seriesId),
    unique("bookings_access_token_hash_unique").on(table.accessTokenHash),
    check("bookings_valid_range", sql`${table.startsAt} < ${table.endsAt}`),
    check(
      "bookings_cancel_reason",
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null)`,
    ),
  ],
);

export type BookingKind = (typeof bookingKind.enumValues)[number];
export type BookingCancelReason =
  (typeof bookingCancelReason.enumValues)[number];

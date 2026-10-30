import { sql } from "drizzle-orm";
import { check, index, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice, PracticeMember } from "./practice";

/**
 * A recurring booking: the same time every week or every other week, booked
 * at once from the client's balance (one credit per booking). Each occurrence
 * is an ordinary row in `bookings` with `series_id` set — cancelled, reminded
 * and exported one by one. Whether a series is still running is read off its
 * bookings; `cancelledAt` only marks that it was cancelled as a whole.
 */
export const BookingSeries = pgTable(
  "booking_series",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    memberId: t
      .uuid()
      .notNull()
      .references(() => PracticeMember.id, { onDelete: "cascade" }),
    /** 1 — every week, 2 — every other week. */
    intervalWeeks: t.smallint().notNull(),
    /** Bookings created with the series (dates skipped on purpose excluded). */
    count: t.smallint().notNull(),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    cancelledAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("booking_series_member_idx").on(table.memberId),
    check("booking_series_interval", sql`${table.intervalWeeks} in (1, 2)`),
    check("booking_series_count", sql`${table.count} between 2 and 12`),
  ],
);

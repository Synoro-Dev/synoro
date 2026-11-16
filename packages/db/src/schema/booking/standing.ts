import { sql } from "drizzle-orm";
import { check, index, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice, PracticeMember } from "./practice";
import { Service } from "./service";

/**
 * A standing time («Про»): the same local time every week or every other
 * week with no end, kept for one client until they or the specialist end it.
 * Unlike `booking_series` it books a few weeks ahead only; a daily cron
 * (`standing-horizon`) adds the next occurrences as the horizon moves.
 *
 * Each occurrence is an ordinary row in `bookings` with `standing_id` and
 * `standing_slot` (the occurrence's own time, which a move never changes, so
 * a cancelled or moved occurrence is not made again). A funded occurrence is
 * confirmed and takes its price from the balance; an unfunded one is a hold
 * (`hold_until`) until the client tops up. A hold that runs out unpaid
 * releases the time and pauses the standing time (`pausedAt`) until it is
 * resumed.
 */
export const StandingTime = pgTable(
  "standing_times",
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
    /** What is booked; the practice's first service when null. */
    serviceId: t.uuid().references(() => Service.id, { onDelete: "set null" }),
    /** The first occurrence; the others follow at the same local time. */
    startsAt: t.timestamp({ withTimezone: true }).notNull(),
    /** 1 — every week, 2 — every other week. */
    intervalWeeks: t.smallint().notNull(),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    /** Held back: a hold ran out unpaid. Nothing is made until it is resumed. */
    pausedAt: t.timestamp({ withTimezone: true }),
    /** Ended for good by the client or the specialist. */
    endedAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("standing_times_member_idx").on(table.memberId),
    index("standing_times_practice_idx").on(table.practiceId),
    check("standing_times_interval", sql`${table.intervalWeeks} in (1, 2)`),
  ],
);

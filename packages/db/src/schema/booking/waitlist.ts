import { sql } from "drizzle-orm";
import { check, index, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice } from "./practice";
import { Service } from "./service";

/**
 * Someone waiting for time to free up: they found no suitable window and left
 * a wish — a service, a range of dates (local days of `Practice.timezone`) and
 * optionally hours of the day. When a booking of the practice is cancelled or
 * moved, the entries it fits are told once (`notified_at`) and book the time
 * on the page themselves; the `bookings_no_overlap` constraint decides who
 * gets it. An entry is told once, then it is done: asking again is a new one.
 *
 * `from_minute` / `to_minute` are minutes since local midnight, on the
 * half-hour grid, like the working hours; null on either side is no limit.
 */
export const WaitlistEntry = pgTable(
  "waitlist_entries",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The service wanted; null — whatever the practice offers first. */
    serviceId: t.uuid().references(() => Service.id, { onDelete: "set null" }),
    fromDate: t.date({ mode: "string" }).notNull(),
    toDate: t.date({ mode: "string" }).notNull(),
    fromMinute: t.smallint(),
    toMinute: t.smallint(),
    notifiedAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("waitlist_entries_practice_idx").on(table.practiceId, table.toDate),
    index("waitlist_entries_user_idx").on(table.userId),
    check(
      "waitlist_entries_dates_ordered",
      sql`${table.fromDate} <= ${table.toDate}`,
    ),
    check(
      "waitlist_entries_minutes_valid",
      sql`(${table.fromMinute} is null or (${table.fromMinute} between 0 and 1410 and ${table.fromMinute} % 30 = 0)) and (${table.toMinute} is null or (${table.toMinute} between 30 and 1440 and ${table.toMinute} % 30 = 0)) and (${table.fromMinute} is null or ${table.toMinute} is null or ${table.fromMinute} < ${table.toMinute})`,
    ),
  ],
);

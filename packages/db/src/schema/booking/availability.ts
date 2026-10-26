import { sql } from "drizzle-orm";
import { check, index, pgTable } from "drizzle-orm/pg-core";

import { Practice } from "./practice";

/**
 * Weekly working hours: on `weekday` (ISO, 1 = Monday … 7 = Sunday) the
 * practice accepts clients from `startMinute` to `endMinute`, in minutes
 * since local midnight of `Practice.timezone`. Several rules per day are
 * allowed (e.g. 10:00–13:00 and 15:00–19:00). Half-hour aligned, because
 * free consultations are booked on a 30-minute grid.
 */
export const AvailabilityRule = pgTable(
  "availability_rules",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    weekday: t.smallint().notNull(),
    startMinute: t.smallint().notNull(),
    endMinute: t.smallint().notNull(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("availability_rules_practice_idx").on(table.practiceId),
    check(
      "availability_rules_weekday_range",
      sql`${table.weekday} between 1 and 7`,
    ),
    check(
      "availability_rules_minutes_valid",
      sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1440 and ${table.startMinute} < ${table.endMinute} and ${table.startMinute} % 30 = 0 and ${table.endMinute} % 30 = 0`,
    ),
  ],
);

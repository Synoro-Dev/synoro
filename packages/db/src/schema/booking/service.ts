import { sql } from "drizzle-orm";
import { check, index, pgTable } from "drizzle-orm/pg-core";

import { Practice } from "./practice";

/**
 * What a client books: «Консультация 60 мин», «Занятие 90 мин». The paid
 * services of a practice; the free intro stays `practices.intro_minutes`.
 *
 * `credits` is the price in credits of the balance (занятия): a 90-minute
 * lesson may cost two. A booking keeps what it was charged
 * (`bookings.credits`), so a later price change doesn't touch refunds.
 * Slots of a service start on the hour when it lasts whole hours and on the
 * half hour otherwise (`serviceStepMinutes` in `lib/schedule.ts`).
 *
 * A service is never deleted while bookings point at it: it is switched off
 * (`active`), and bookings keep their `service_id` for the history.
 */
export const Service = pgTable(
  "services",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 80 }).notNull(),
    /** Length of one booking, a multiple of 5 from 15 to 240. */
    minutes: t.smallint().notNull().default(60),
    /** Price in credits (1–10). */
    credits: t.smallint().notNull().default(1),
    /** Order on the booking page, ascending. */
    position: t.smallint().notNull().default(0),
    /** Switched off: not offered, kept for the bookings that used it. */
    active: t.boolean().notNull().default(true),
    /**
     * Removed by the owner but still pointed at by bookings or waiting-list
     * wishes: it stays for their history, is never offered and no longer
     * shows in the editor or counts against the limit. Always `active = false`.
     */
    archived: t.boolean().notNull().default(false),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("services_practice_idx").on(table.practiceId, table.position),
    check(
      "services_minutes_valid",
      sql`${table.minutes} between 15 and 240 and ${table.minutes} % 5 = 0`,
    ),
    check("services_credits_range", sql`${table.credits} between 1 and 10`),
  ],
);

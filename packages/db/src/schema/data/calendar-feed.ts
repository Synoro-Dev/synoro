import { pgTable } from "drizzle-orm/pg-core";

import { Practice } from "../booking/practice";

/**
 * The practice's schedule as an iCalendar feed at a secret address, for a
 * subscription in Google or Yandex Calendar. A row means on. Only the hash of
 * the secret is kept, so the link is shown once and reissued if lost.
 */
export const CalendarFeed = pgTable("calendar_feeds", (t) => ({
  practiceId: t
    .uuid()
    .notNull()
    .primaryKey()
    .references(() => Practice.id, { onDelete: "cascade" }),
  /** SHA-256 of the secret in the link. */
  tokenHash: t.varchar({ length: 64 }).notNull().unique(),
  /**
   * Events name the client and their phone. Off, they only say «Запись»: the
   * calendar's provider, and whoever the calendar is shared with, sees them.
   */
  showNames: t.boolean().notNull().default(false),
  lastFetchedAt: t.timestamp({ withTimezone: true }),
  rotatedAt: t.timestamp({ withTimezone: true }),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
}));

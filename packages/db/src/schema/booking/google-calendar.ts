import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice } from "./practice";

/**
 * The specialist's Google account linked to the practice (one per practice,
 * connected by the owner through OAuth). Busy time in `busyCalendarIds` is
 * closed for booking; bookings are written as events to `eventsCalendarId`
 * when `exportBookings` is on.
 */
export const GoogleCalendarConnection = pgTable(
  "google_calendar_connections",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .unique()
      .references(() => Practice.id, { onDelete: "cascade" }),
    connectedById: t.text().references(() => user.id, { onDelete: "set null" }),
    /** The Google account, shown to the specialist. */
    email: t.varchar({ length: 320 }).notNull(),
    /** AES-256-GCM, see `@synoro/api` lib/secrets. Never sent to clients. */
    refreshToken: t.text().notNull(),
    /** AES-256-GCM; refreshed when it expires. */
    accessToken: t.text(),
    accessTokenExpiresAt: t.timestamp({ withTimezone: true }),
    busyCalendarIds: t
      .text()
      .array()
      .notNull()
      .default(sql`'{primary}'::text[]`),
    eventsCalendarId: t.text().notNull().default("primary"),
    exportBookings: t.boolean().notNull().default(true),
    /** Last failure talking to Google (revoked access, …); null when fine. */
    lastError: t.text(),
    lastErrorAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
);

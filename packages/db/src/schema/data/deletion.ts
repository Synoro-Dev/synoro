import { pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * The owner asked to delete their account: a row means it's on its way. Their
 * practices' pages close at once and notices stop. Until `purgeAt` it can be
 * undone by deleting the row; then the `account-purge` cron deletes everything
 * for good.
 */
export const AccountDeletion = pgTable("account_deletions", (t) => ({
  userId: t
    .text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  requestedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  purgeAt: t.timestamp({ withTimezone: true }).notNull(),
  /** The owner's choice, kept so that a repeat finishes what a failure cut off. */
  cancelBookings: t.boolean().notNull().default(false),
  /** Bookings cancelled, the owner mailed, the journal written. */
  completedAt: t.timestamp({ withTimezone: true }),
}));

/**
 * The address of a deleted practice, closed to everyone for a year: clients
 * still have the old link, and whoever took the name would get them.
 */
export const ReservedSlug = pgTable("reserved_slugs", (t) => ({
  slug: t.varchar({ length: 48 }).notNull().primaryKey(),
  until: t.timestamp({ withTimezone: true }).notNull(),
}));

/**
 * That an account was deleted, and how much went with it: the only thing kept,
 * as a record of destroying personal data. No names and no ids.
 */
export const DeletionRecord = pgTable("deletion_records", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  practices: t.integer().notNull(),
  clients: t.integer().notNull(),
  bookings: t.integer().notNull(),
  requestedAt: t.timestamp({ withTimezone: true }).notNull(),
  purgedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
}));

import { sql } from "drizzle-orm";
import { check, pgEnum, pgTable, unique } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * A practice is the SaaS tenant: one specialist's schedule, clients and
 * consultation balances. Everything in the booking domain hangs off it.
 */
export const Practice = pgTable("practices", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.varchar({ length: 120 }).notNull(),
  /** Public booking link: `/p/<slug>`. */
  slug: t.varchar({ length: 48 }).notNull().unique(),
  /** IANA zone the availability rules are written in. */
  timezone: t.text().notNull().default("Europe/Moscow"),
  ownerId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

/**
 * owner  — the specialist: everything, including adding administrators.
 * admin  — administrator: credits, free consultations, blocks, schedule.
 * client — books paid consultations from their `credits` balance.
 */
export const memberRole = pgEnum("practice_member_role", [
  "owner",
  "admin",
  "client",
]);

export const PracticeMember = pgTable(
  "practice_members",
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
    role: memberRole().notNull().default("client"),
    /** Paid consultations left; one is spent per booked hour. */
    credits: t.integer().notNull().default(0),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    unique("practice_members_practice_user_unique").on(
      table.practiceId,
      table.userId,
    ),
    check("practice_members_credits_non_negative", sql`${table.credits} >= 0`),
  ],
);

export type MemberRole = (typeof memberRole.enumValues)[number];

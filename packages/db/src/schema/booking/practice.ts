import { sql } from "drizzle-orm";
import { check, pgEnum, pgTable, unique } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * What the specialist does: picks the words their pages use (consultation,
 * lesson, workout…). Keep in sync with `PROFESSIONS` in `@synoro/validators`.
 */
export const practiceProfession = pgEnum("practice_profession", [
  "psychologist",
  "coach",
  "tutor",
  "trainer",
  "health",
  "legal",
  "other",
]);

/**
 * A practice is the SaaS tenant: one specialist's schedule, clients and
 * credit balances. Everything in the booking domain hangs off it.
 */
export const Practice = pgTable("practices", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.varchar({ length: 120 }).notNull(),
  /** Public booking link: `/p/<slug>`. */
  slug: t.varchar({ length: 48 }).notNull().unique(),
  /** IANA zone the availability rules are written in. */
  timezone: t.text().notNull().default("Europe/Moscow"),
  profession: practiceProfession().notNull().default("other"),
  /**
   * Specialist's photo: the S3 key (`practices/<id>/avatar-<time>.jpg`), not a
   * URL. Served at `/p/<slug>/avatar.jpg`; see `practiceImageUrl` in `@synoro/api`.
   */
  image: t.text(),
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
 * admin  — administrator: credits, free bookings, blocks, schedule.
 * client — books paid slots from their `credits` balance.
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
    /** Paid bookings left; one is spent per booked hour. */
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
export type PracticeProfession = (typeof practiceProfession.enumValues)[number];

import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, unique } from "drizzle-orm/pg-core";

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

/** Mirrors `BookingQuestion` in `@synoro/validators`. */
export interface PracticeBookingQuestion {
  id: string;
  label: string;
  kind: "text" | "long_text" | "choice";
  options: string[];
  required: boolean;
}

/** Mirrors `BookingTheme` in `@synoro/validators`; every key may be missing. */
export interface PracticeBookingTheme {
  accent?: string;
  font?: string;
  radius?: string;
  backdrop?: string;
  about?: string;
}

/**
 * A practice is the SaaS tenant: one specialist's schedule, clients and
 * credit balances. Everything in the booking domain hangs off it.
 */
export const Practice = pgTable("practices", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.varchar({ length: 120 }).notNull(),
  /** Public booking link: `/<slug>`. */
  slug: t.varchar({ length: 48 }).notNull().unique(),
  /** IANA zone the availability rules are written in. */
  timezone: t.text().notNull().default("Europe/Moscow"),
  profession: practiceProfession().notNull().default("other"),
  /**
   * Specialist's photo: the S3 key (`practices/<id>/avatar-<time>.jpg`), not a
   * URL. Served at `/<slug>/avatar.jpg`; see `practiceImageUrl` in `@synoro/api`.
   * The demo seed stores a path from the app's `public/` instead (`/demo/…`).
   */
  image: t.text(),
  /**
   * The specialist's permanent video room (Толк, Телемост…): `https` only,
   * see `normalizeVideoUrl` in `@synoro/validators`. Shown to clients of
   * confirmed bookings that have no `meetingUrl` of their own.
   */
  videoUrl: t.text(),
  /**
   * How clients reach the specialist (a phone, Telegram…): free text, see
   * `practiceContactSchema` in `@synoro/validators`. Shown to clients of
   * confirmed bookings only, never on the public page.
   */
  clientContact: t.text(),
  /**
   * The questionnaire clients fill in when booking («Про»), in the order
   * shown. Validated by `bookingQuestionsSchema` in `@synoro/validators`;
   * kept while the owner is on the free plan, but not asked.
   */
  bookingQuestions: t
    .jsonb()
    .$type<PracticeBookingQuestion[]>()
    .notNull()
    .default([]),
  /**
   * Visitors may book the free intro (`bookings.kind = 'free'`) themselves on
   * the booking page, once per person. Off: only staff book it.
   */
  freeBookingEnabled: t.boolean().notNull().default(false),
  /**
   * How long the free intro lasts, in minutes — one of `INTRO_MINUTES` in
   * `@synoro/validators`. It starts on the half-hour grid whatever its
   * length; intros already booked keep theirs.
   */
  introMinutes: t.integer().notNull().default(30),
  /**
   * The specialist is paid at the visit: clients book any active service
   * themselves without paying in Synoro (`booking.bookAtVisit`), confirmed at
   * once with `bookings.credits = 0`, and staff book without the balance. The
   * booking page then offers no online payment and no packages.
   */
  payAtVisit: t.boolean().notNull().default(false),
  /**
   * How the booking page looks («Про»): accent, typeface, corners, backdrop,
   * «about» line. Read through `readBookingTheme` in `@synoro/validators`
   * (missing keys are the default look); kept on the free plan, not shown.
   */
  bookingTheme: t.jsonb().$type<PracticeBookingTheme>().notNull().default({}),
  /** Clients get reminders 24 h and 1 h before a meeting. */
  remindClients: t.boolean().notNull().default(true),
  /** Owner and administrators hear of bookings made and cancelled. */
  notifyStaff: t.boolean().notNull().default(true),
  /** Owner and administrators get tomorrow's bookings at 20:00, practice time. */
  dailyAgenda: t.boolean().notNull().default(true),
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
 * An address the practice used to have. Clients keep old links, so it stays
 * the practice's for good: the booking page redirects to the current address,
 * and nobody else can take the name.
 */
export const PracticeSlugAlias = pgTable(
  "practice_slug_aliases",
  (t) => ({
    slug: t.varchar({ length: 48 }).notNull().primaryKey(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [index("practice_slug_aliases_practice_idx").on(table.practiceId)],
);

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

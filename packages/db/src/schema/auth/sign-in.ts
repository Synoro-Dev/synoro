import { index, pgTable } from "drizzle-orm/pg-core";

import { user } from "./user";

/**
 * History of sign-ins: one row per session Better Auth opens (a code or
 * password sign-in, a sign-up, an admin's impersonation). `sessions` can't
 * serve as the history: a sign-out or expiry deletes the row.
 *
 * Besides who, when and from where (IP, device, city by IP), a row keeps
 * where the person came from, read off the cookies the landing set on the
 * first visit (docs/sign-in-history.md): the Yandex Direct click and UTM
 * tags for an ad, the referring site for everything else.
 */
export const SignIn = pgTable(
  "sign_ins",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Auth endpoint that opened the session, e.g. `/sign-in/email-otp`. */
    method: t.text(),
    /** The admin who signed in as this user, if it was an impersonation. */
    impersonatedBy: t.text(),
    ipAddress: t.text(),
    userAgent: t.text(),
    /** ISO 3166-1 alpha-2, from the IP lookup; null until it answers. */
    country: t.varchar({ length: 2 }),
    region: t.text(),
    city: t.text(),
    /** Yandex Direct click id and when the click happened. */
    yclid: t.varchar({ length: 64 }),
    yclidAt: t.timestamp({ withTimezone: true }),
    utmSource: t.text(),
    utmMedium: t.text(),
    utmCampaign: t.text(),
    utmContent: t.text(),
    utmTerm: t.text(),
    /** Host of the site that sent the visitor, when it was not an ad. */
    referrerHost: t.text(),
    /** Path of the first page the visitor opened. */
    landingPath: t.text(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("sign_ins_user_created_idx").on(table.userId, table.createdAt),
    index("sign_ins_created_idx").on(table.createdAt),
    index("sign_ins_ip_idx").on(table.ipAddress),
  ],
);

export type SignInRow = typeof SignIn.$inferSelect;

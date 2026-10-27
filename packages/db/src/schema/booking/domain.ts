import { sql } from "drizzle-orm";
import { pgEnum, pgTable } from "drizzle-orm/pg-core";

import { Practice } from "./practice";

/**
 * pending — added, the TXT record proving ownership not seen yet.
 * active  — ownership confirmed: the host serves the practice's page.
 */
export const domainStatus = pgEnum("practice_domain_status", [
  "pending",
  "active",
]);

/**
 * The specialist's own domain or subdomain for the booking page
 * (`anna-ivanova.ru`, `zapis.anna-ivanova.ru`). One per practice; a host belongs to
 * at most one practice. Platform subdomains (`<slug>.<root>`) need no row.
 */
export const PracticeDomain = pgTable("practice_domains", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  practiceId: t
    .uuid()
    .notNull()
    .unique()
    .references(() => Practice.id, { onDelete: "cascade" }),
  /** Lowercase ASCII (punycode for IDN), no port or trailing dot. */
  hostname: t.varchar({ length: 253 }).notNull().unique(),
  /** Expected in the `_booking-verification.<hostname>` TXT record. */
  verificationToken: t.text().notNull(),
  status: domainStatus().notNull().default("pending"),
  verifiedAt: t.timestamp({ withTimezone: true }),
  lastCheckedAt: t.timestamp({ withTimezone: true }),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export type DomainStatus = (typeof domainStatus.enumValues)[number];

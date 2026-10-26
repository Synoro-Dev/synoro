import { sql } from "drizzle-orm";
import { check, pgTable, unique } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { memberRole, Practice } from "./practice";

/** Pending invitations grant no membership or access to the recipient's profile. */
export const PracticeInvitation = pgTable(
  "practice_invitations",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    email: t.text().notNull(),
    role: memberRole().notNull(),
    invitedById: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    expiresAt: t
      .timestamp({ withTimezone: true })
      .default(sql`now() + interval '7 days'`)
      .notNull(),
  }),
  (table) => [
    unique("practice_invitations_practice_email_role_unique").on(
      table.practiceId,
      table.email,
      table.role,
    ),
    check(
      "practice_invitations_role_valid",
      sql`${table.role} in ('admin', 'client')`,
    ),
  ],
);

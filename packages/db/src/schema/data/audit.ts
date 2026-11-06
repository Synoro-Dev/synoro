import { index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice } from "../booking/practice";

/** Keep in sync with the labels on the data settings page. */
export const dataAuditAction = pgEnum("data_audit_action", [
  "access_confirmed",
  "export_requested",
  "export_downloaded",
  "partial_export",
  "feed_enabled",
  "feed_rotated",
  "feed_disabled",
  "backup_enabled",
  "backup_disabled",
  "import_applied",
  "import_undone",
  "deletion_requested",
  "deletion_cancelled",
]);

/**
 * Who took what out of an account, brought into it or asked to delete it. The
 * specialist reads it in the settings. `details` holds counts and kinds, never
 * names, phones or anything else from the data itself. Kept for 12 months,
 * like the other security logs in the privacy policy.
 */
export const DataAuditEntry = pgTable(
  "data_audit_log",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    /** The account whose data this is. */
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Who did it: the owner, or null for the weekly copy made by a cron. */
    actorId: t.text().references(() => user.id, { onDelete: "set null" }),
    practiceId: t
      .uuid()
      .references(() => Practice.id, { onDelete: "set null" }),
    action: dataAuditAction().notNull(),
    details: t
      .jsonb()
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("data_audit_log_user_created_idx").on(table.userId, table.createdAt),
    index("data_audit_log_created_idx").on(table.createdAt),
  ],
);

export type DataAuditAction = (typeof dataAuditAction.enumValues)[number];

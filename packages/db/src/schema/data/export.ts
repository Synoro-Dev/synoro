import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * full   — everything of the account, asked for with the button.
 * weekly — the weekly copy of the client base (`ClientBackup`).
 */
export const dataExportKind = pgEnum("data_export_kind", ["full", "weekly"]);

/**
 * pending / running — the background task hasn't finished;
 * ready   — the archive is in the bucket under `fileKey`;
 * failed  — it could not be built, the specialist may ask again;
 * expired — the link ran out and the archive was deleted.
 */
export const dataExportStatus = pgEnum("data_export_status", [
  "pending",
  "running",
  "ready",
  "failed",
  "expired",
]);

/**
 * An archive of the account's data, built by the `data-export` task. Its
 * link needs a signed-in owner and lives until `expiresAt`, when the cleanup
 * cron deletes the file. The row stays as a record of what was asked for.
 */
export const DataExport = pgTable(
  "data_exports",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: dataExportKind().notNull(),
    status: dataExportStatus().notNull().default("pending"),
    /** The object in the bucket; null until ready and after it expired. */
    fileKey: t.text(),
    sizeBytes: t.integer(),
    /** `format_version` of the `data.json` inside. */
    formatVersion: t.integer(),
    expiresAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("data_exports_user_created_idx").on(table.userId, table.createdAt),
    index("data_exports_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

/**
 * The specialist asked for a weekly copy of their client base: a row means on.
 * The mail carries a link that needs a sign-in, never the data itself.
 */
export const ClientBackup = pgTable("client_backups", (t) => ({
  userId: t
    .text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  lastRunAt: t.timestamp({ withTimezone: true }),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
}));

export type DataExportKind = (typeof dataExportKind.enumValues)[number];
export type DataExportStatus = (typeof dataExportStatus.enumValues)[number];

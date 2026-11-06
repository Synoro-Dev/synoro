import { sql } from "drizzle-orm";
import {
  customType,
  index,
  pgEnum,
  pgTable,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice } from "../booking/practice";

/** table — CSV or XLSX; calendar — ICS or Google; archive — our `data.json`. */
export const importSource = pgEnum("import_source", [
  "table",
  "calendar",
  "archive",
]);

/**
 * draft    — uploaded, being looked at; nothing is written yet;
 * applying — the rows are being written, `progress` says how far;
 * applied  — done, can be undone;
 * failed   — stopped halfway; what was written can be undone;
 * undone   — everything it added is gone;
 * expired  — a draft nobody finished, its file deleted.
 */
export const importStatus = pgEnum("import_status", [
  "draft",
  "applying",
  "applied",
  "failed",
  "undone",
  "expired",
]);

export interface ImportTotals {
  added: number;
  merged: number;
  skipped: number;
  errors: number;
}

export interface ImportOptions {
  duplicates: "merge" | "skip";
  /** The note column goes in only when the specialist asks for it. */
  importNotes: boolean;
  /** Field per column of the file; null: the column is left out. */
  mapping: (string | null)[];
  /** Calendar events go in as bookings, or just as closed time. */
  eventsAs?: "bookings" | "blocked";
  /** Which practice of an archive goes into this one. */
  archivePractice?: number;
  /** Decided once: on a rerun the practice is no longer empty. */
  archiveClean?: boolean;
}

/**
 * One import: undoing it removes exactly what `ImportBatchItem` lists. The name
 * of the file and the counts are all it keeps of the data itself.
 */
export const ImportBatch = pgTable(
  "import_batches",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    source: importSource().notNull(),
    status: importStatus().notNull().default("draft"),
    fileName: t.varchar({ length: 255 }).notNull(),
    options: t.jsonb().$type<ImportOptions>(),
    totals: t.jsonb().$type<ImportTotals>(),
    rowCount: t.integer().notNull().default(0),
    /** Rows written so far, while applying. */
    progress: t.integer().notNull().default(0),
    appliedAt: t.timestamp({ withTimezone: true }),
    undoneAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("import_batches_practice_created_idx").on(
      table.practiceId,
      table.createdAt,
    ),
  ],
);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/**
 * The uploaded file, while it's needed: for the preview, and for downloading
 * the rows that failed. In a table of its own so that nothing reads it in
 * passing. Deleted at `expiresAt` or when the import is undone.
 */
export const ImportFile = pgTable(
  "import_files",
  (t) => ({
    batchId: t
      .uuid()
      .notNull()
      .primaryKey()
      .references(() => ImportBatch.id, { onDelete: "cascade" }),
    content: bytea().notNull(),
    expiresAt: t.timestamp({ withTimezone: true }).notNull(),
  }),
  (table) => [index("import_files_expires_idx").on(table.expiresAt)],
);

export const importItemEntity = pgEnum("import_item_entity", [
  "client",
  "booking",
  "series",
  "record",
  "hours",
  "package",
  "message",
  "settings",
]);

/**
 * What one import did. added — delete it on undo; merged — it filled in empty
 * fields of an existing card, `before` holds what they were.
 */
export const importItemAction = pgEnum("import_item_action", [
  "added",
  "merged",
]);

export const ImportBatchItem = pgTable(
  "import_batch_items",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    batchId: t
      .uuid()
      .notNull()
      .references(() => ImportBatch.id, { onDelete: "cascade" }),
    entity: importItemEntity().notNull(),
    entityId: t.uuid().notNull(),
    action: importItemAction().notNull(),
    before: t.jsonb().$type<Record<string, unknown>>(),
    /** What it wrote there: undoing leaves a field changed since then alone. */
    after: t.jsonb().$type<Record<string, unknown>>(),
    /**
     * Which part of the file this came from. A rerun after a crash skips what
     * is already here, which contacts alone can't tell for a card without any.
     */
    sourceKey: t.text(),
  }),
  (table) => [
    index("import_batch_items_batch_idx").on(table.batchId),
    uniqueIndex("import_batch_items_source_idx")
      .on(table.batchId, table.sourceKey)
      .where(sql`${table.sourceKey} is not null`),
  ],
);

export type ImportStatus = (typeof importStatus.enumValues)[number];

/**
 * History from an archive that has no live place here: old online payments and
 * balance journal lines. A payment needs a merchant account with its key, which
 * an archive never holds, and a journal line an account. Kept as it was and
 * given back in the next export, so nothing is lost on the way through.
 */
export const archivedRecordKind = pgEnum("archived_record_kind", [
  "payment",
  "credit_entry",
]);

export const ArchivedRecord = pgTable(
  "archived_records",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    kind: archivedRecordKind().notNull(),
    data: t.jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: t.timestamp({ withTimezone: true }).notNull(),
  }),
  (table) => [
    index("archived_records_practice_idx").on(table.practiceId, table.kind),
  ],
);

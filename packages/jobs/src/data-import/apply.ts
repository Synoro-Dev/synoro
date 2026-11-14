import { logger } from "@synoro/config";
import {
  ArchivedRecord,
  AvailabilityRule,
  and,
  Booking,
  BookingSeries,
  Consent,
  count,
  type Database,
  eq,
  ImportBatch,
  ImportBatchItem,
  ImportFile,
  type ImportOptions,
  inArray,
  lte,
  PaymentPackage,
  Practice,
  PracticeClient,
  PracticeDocument,
  PracticeDocumentVersion,
  sql,
  Workflow,
} from "@synoro/db";

import { toCsv } from "../data-export/csv";
import { analyzeRows, type CleanClient, loadExisting } from "./analyze";
import { doneItems, loadImportFile } from "./apply-file";
import { applyArchive } from "./archive";
import { applyCalendar } from "./calendar";
import { readTable } from "./parse";

const CHUNK = 200;
/** No progress for this long: the worker isn't coming back to it. */
const STUCK_AFTER_MS = 60 * 60 * 1000;

/**
 * What the card lacks. It never overwrites what the specialist has, and leaves
 * a contact that's already someone else's: one row can match two cards.
 */
function missingFields(
  card: typeof PracticeClient.$inferSelect,
  client: CleanClient,
  taken: { phone(value: string): boolean; email(value: string): boolean },
) {
  const set: Partial<Pick<CleanClient, "phone" | "email" | "note">> = {};
  if (!card.phone && client.phone && !taken.phone(client.phone)) {
    set.phone = client.phone;
  }
  if (!card.email && client.email && !taken.email(client.email)) {
    set.email = client.email;
  }
  if (!card.note && client.note) set.note = client.note;
  return set;
}

/**
 * Write a table's clients as cards, chunk by chunk, each in a transaction. A
 * rerun after a crash finds what it already wrote as duplicates, so nothing is
 * added twice, and totals come from the journal of what was done. Writes no
 * mail and queues nothing: an imported client is told nothing, ever.
 */
async function applyTable(
  db: Database,
  batchId: string,
  options: ImportOptions,
) {
  const batch = await db.query.ImportBatch.findFirst({
    where: eq(ImportBatch.id, batchId),
  });
  const file = await loadImportFile(db, batchId);
  if (!batch || !file) throw new Error(`Import ${batchId} has no file`);

  const table = readTable(file);
  const existing = await loadExisting(db, batch.practiceId);
  const results = analyzeRows(table, options.mapping, existing);
  // Later rows of the file that repeat an earlier one merge into its card.
  const cardByPhone = new Map<string, string>();
  const cardByEmail = new Map<string, string>();
  const done = await doneItems(db, batchId);

  let skipped = 0;
  for (let start = 0; start < results.length; start += CHUNK) {
    await db.transaction(async (tx) => {
      for (const row of results.slice(start, start + CHUNK)) {
        if (row.status === "error") continue;
        const client = options.importNotes
          ? row.client
          : { ...row.client, note: null };

        if (row.status === "new") {
          const sourceKey = `row:${row.index}`;
          const written = done.get(sourceKey);
          if (written) {
            if (client.phone) cardByPhone.set(client.phone, written);
            if (client.email) cardByEmail.set(client.email, written);
            continue;
          }
          const [card] = await tx
            .insert(PracticeClient)
            .values({ ...client, practiceId: batch.practiceId, batchId })
            .onConflictDoNothing()
            .returning({ id: PracticeClient.id });
          if (!card) {
            skipped++;
            continue;
          }
          await tx.insert(ImportBatchItem).values({
            batchId,
            entity: "client",
            entityId: card.id,
            action: "added",
            sourceKey,
          });
          if (client.phone) cardByPhone.set(client.phone, card.id);
          if (client.email) cardByEmail.set(client.email, card.id);
          continue;
        }

        const cardId =
          row.match.kind === "card"
            ? row.match.id
            : row.match.kind === "file"
              ? ((client.phone && cardByPhone.get(client.phone)) ??
                (client.email && cardByEmail.get(client.email)))
              : undefined;
        if (options.duplicates === "skip" || !cardId) {
          skipped++;
          continue;
        }
        const card = await tx.query.PracticeClient.findFirst({
          where: eq(PracticeClient.id, cardId),
        });
        if (!card) {
          skipped++;
          continue;
        }
        const set = missingFields(card, client, {
          phone: (value) =>
            existing.phones.has(value) || cardByPhone.has(value),
          email: (value) =>
            existing.emails.has(value) || cardByEmail.has(value),
        });
        const fields = Object.keys(set) as (keyof typeof set)[];
        if (fields.length === 0) {
          skipped++;
          continue;
        }
        await tx
          .update(PracticeClient)
          .set(set)
          .where(eq(PracticeClient.id, card.id));
        if (set.phone) cardByPhone.set(set.phone, card.id);
        if (set.email) cardByEmail.set(set.email, card.id);
        // Filled in from a repeat of its own row: undoing the add covers it.
        if (card.batchId !== batchId) {
          await tx.insert(ImportBatchItem).values({
            batchId,
            entity: "client",
            entityId: card.id,
            action: "merged",
            before: Object.fromEntries(
              fields.map((field) => [field, card[field]]),
            ),
            after: set,
          });
        }
      }
    });
    await db
      .update(ImportBatch)
      .set({ progress: Math.min(start + CHUNK, results.length) })
      .where(eq(ImportBatch.id, batchId));
  }

  const counts = await db
    .select({ action: ImportBatchItem.action, value: count() })
    .from(ImportBatchItem)
    .where(eq(ImportBatchItem.batchId, batchId))
    .groupBy(ImportBatchItem.action);
  const of = (action: "added" | "merged") =>
    counts.find((row) => row.action === action)?.value ?? 0;
  return {
    added: of("added"),
    merged: of("merged"),
    skipped,
    errors: results.filter((row) => row.status === "error").length,
  };
}

/** The rows that didn't go in, as a table to fix and upload again. */
export function rejectedCsv(file: Uint8Array, mapping: (string | null)[]) {
  const table = readTable(file);
  const rows = analyzeRows(table, mapping, {
    phones: new Map(),
    emails: new Map(),
  }).flatMap((row) =>
    row.status === "error"
      ? [[...(table.rows[row.index] ?? []), row.reasons.join("; ")]]
      : [],
  );
  return toCsv([...table.headers, "Ошибка"], rows);
}

/** Equal as JSON: key order means nothing, and jsonb keeps none. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(norm)
      : value && typeof value === "object"
        ? Object.entries(value)
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([key, item]) => [key, norm(item)])
        : (value ?? null);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** The fields still holding what the import wrote: what's safe to put back. */
function untouched(
  current: Record<string, unknown>,
  item: { before: Record<string, unknown> | null; after: unknown },
) {
  const after = (item.after ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(item.before ?? {}).filter(([field]) =>
      sameValue(current[field], after[field]),
    ),
  );
}

/**
 * Remove exactly what this import did. What it added goes; what it filled in on
 * cards or in settings is put back, unless someone changed that field since. Its
 * file goes too. One transaction, so it's all or nothing, and taking the status
 * first means two tabs can't both do it. Null: it isn't applied, or is undone.
 */
export function undoImport(db: Database, batchId: string) {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(ImportBatch)
      .set({ status: "undone", undoneAt: new Date() })
      .where(
        and(
          eq(ImportBatch.id, batchId),
          inArray(ImportBatch.status, ["applied", "failed"]),
        ),
      )
      .returning({ id: ImportBatch.id });
    if (!claimed) return null;

    const items = await tx
      .select()
      .from(ImportBatchItem)
      .where(eq(ImportBatchItem.batchId, batchId));
    const added = (entity: (typeof items)[number]["entity"]) =>
      items
        .filter((item) => item.action === "added" && item.entity === entity)
        .map((item) => item.entityId);
    // Bookings before what they point to.
    const drops = [
      [Booking, Booking.id, added("booking")],
      [BookingSeries, BookingSeries.id, added("series")],
      [PracticeClient, PracticeClient.id, added("client")],
      [ArchivedRecord, ArchivedRecord.id, added("record")],
      [AvailabilityRule, AvailabilityRule.id, added("hours")],
      [PaymentPackage, PaymentPackage.id, added("package")],
      [Workflow, Workflow.id, added("message")],
    ] as const;
    for (const [table, column, ids] of drops) {
      if (ids.length > 0) await tx.delete(table).where(inArray(column, ids));
    }
    // Documents the import added: one a client has accepted since stays, put
    // away — deleting it would take the consents with it.
    const documentIds = added("document");
    if (documentIds.length > 0) {
      const used = await tx
        .selectDistinct({ id: PracticeDocumentVersion.documentId })
        .from(Consent)
        .innerJoin(
          PracticeDocumentVersion,
          eq(PracticeDocumentVersion.id, Consent.versionId),
        )
        .where(inArray(PracticeDocumentVersion.documentId, documentIds));
      const kept = used.map((row) => row.id);
      const unused = documentIds.filter((id) => !kept.includes(id));
      if (unused.length > 0) {
        await tx
          .delete(PracticeDocument)
          .where(inArray(PracticeDocument.id, unused));
      }
      if (kept.length > 0) {
        await tx
          .update(PracticeDocument)
          .set({ archived: true })
          .where(inArray(PracticeDocument.id, kept));
      }
    }
    for (const item of items) {
      if (item.action !== "merged" || !item.before) continue;
      if (item.entity === "settings") {
        const current = await tx.query.Practice.findFirst({
          where: eq(Practice.id, item.entityId),
        });
        const set = current && untouched(current, item);
        if (set && Object.keys(set).length > 0) {
          await tx
            .update(Practice)
            .set(set)
            .where(eq(Practice.id, item.entityId));
        }
      } else {
        const current = await tx.query.PracticeClient.findFirst({
          where: eq(PracticeClient.id, item.entityId),
        });
        const set = current && untouched(current, item);
        if (set && Object.keys(set).length > 0) {
          await tx
            .update(PracticeClient)
            .set(set)
            .where(eq(PracticeClient.id, item.entityId));
        }
      }
    }
    await tx.delete(ImportFile).where(eq(ImportFile.batchId, batchId));
    await tx
      .delete(ImportBatchItem)
      .where(eq(ImportBatchItem.batchId, batchId));
    return { removed: items.filter((item) => item.action === "added").length };
  });
}

/**
 * Write the import. An attempt that fails stays `applying` if another is coming
 * (`final` false), so the retry can pick up where it stopped; the last failure
 * marks the batch, and what's written can still be undone.
 */
export async function runImport(
  db: Database,
  batchId: string,
  { final = true }: { final?: boolean } = {},
) {
  const batch = await db.query.ImportBatch.findFirst({
    where: eq(ImportBatch.id, batchId),
  });
  if (!batch?.options || batch.status !== "applying") return;
  try {
    const totals =
      batch.source === "calendar"
        ? await applyCalendar(db, batchId, batch.options.eventsAs ?? "bookings")
        : batch.source === "archive"
          ? await applyArchive(db, batchId, batch.options.archivePractice ?? 0)
          : await applyTable(db, batchId, batch.options);
    await db
      .update(ImportBatch)
      .set({ status: "applied", totals, appliedAt: new Date() })
      .where(eq(ImportBatch.id, batchId));
  } catch (error) {
    logger.warn("data_import.failed", {
      batchId,
      // The message may quote a value from the file: its kind is enough here.
      error: error instanceof Error ? error.name : "unknown",
    });
    if (final) {
      await db
        .update(ImportBatch)
        .set({ status: "failed" })
        .where(eq(ImportBatch.id, batchId));
    }
    throw error;
  }
}

/**
 * Files past their term, drafts nobody finished, and imports whose worker died:
 * marked failed, so that what they wrote can be undone and the page stops waiting.
 */
export async function cleanupImports(db: Database, now = new Date()) {
  await db
    .update(ImportBatch)
    .set({ status: "failed" })
    .where(
      and(
        eq(ImportBatch.status, "applying"),
        sql`coalesce(${ImportBatch.updatedAt}, ${ImportBatch.createdAt}) < ${new Date(now.getTime() - STUCK_AFTER_MS).toISOString()}::timestamptz`,
      ),
    );

  const gone = await db
    .delete(ImportFile)
    .where(lte(ImportFile.expiresAt, now))
    .returning({ batchId: ImportFile.batchId });
  const ids = gone.map((row) => row.batchId);
  if (ids.length > 0) {
    await db
      .update(ImportBatch)
      .set({ status: "expired" })
      .where(
        and(inArray(ImportBatch.id, ids), eq(ImportBatch.status, "draft")),
      );
  }
  return { removed: ids.length };
}

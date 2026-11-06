import { logger } from "@synoro/config";
import {
  and,
  Booking,
  count,
  type Database,
  eq,
  ImportBatch,
  ImportBatchItem,
  ImportFile,
  type ImportOptions,
  inArray,
  lte,
  PracticeClient,
} from "@synoro/db";

import { toCsv } from "../data-export/csv";
import { analyzeRows, type CleanClient, loadExisting } from "./analyze";
import { readTable } from "./parse";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long the file stays for the rows that failed. */
export const IMPORT_FILE_DAYS = 7;
const CHUNK = 200;

export async function loadImportFile(db: Database, batchId: string) {
  const row = await db.query.ImportFile.findFirst({
    where: eq(ImportFile.batchId, batchId),
  });
  return row ? new Uint8Array(row.content) : null;
}

export async function saveImportFile(
  db: Database,
  batchId: string,
  content: Uint8Array,
  now = new Date(),
) {
  await db.insert(ImportFile).values({
    batchId,
    content,
    expiresAt: new Date(now.getTime() + IMPORT_FILE_DAYS * DAY_MS),
  });
}

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
export async function applyTable(
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

  let skipped = 0;
  for (let start = 0; start < results.length; start += CHUNK) {
    await db.transaction(async (tx) => {
      for (const row of results.slice(start, start + CHUNK)) {
        if (row.status === "error") continue;
        const client = options.importNotes
          ? row.client
          : { ...row.client, note: null };

        if (row.status === "new") {
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

/**
 * Remove exactly what this import did. What it added goes, what it filled in on
 * existing cards is put back. Its file
 * goes too. One transaction, so it's all or nothing.
 */
export async function undoImport(db: Database, batchId: string) {
  const items = await db
    .select()
    .from(ImportBatchItem)
    .where(eq(ImportBatchItem.batchId, batchId));

  await db.transaction(async (tx) => {
    const added = (entity: "client" | "booking") =>
      items
        .filter((item) => item.action === "added" && item.entity === entity)
        .map((item) => item.entityId);
    const bookings = added("booking");
    if (bookings.length > 0) {
      await tx.delete(Booking).where(inArray(Booking.id, bookings));
    }
    const clients = added("client");
    if (clients.length > 0) {
      await tx
        .delete(PracticeClient)
        .where(inArray(PracticeClient.id, clients));
    }
    for (const item of items) {
      if (item.action !== "merged" || !item.before) continue;
      await tx
        .update(PracticeClient)
        .set(item.before)
        .where(eq(PracticeClient.id, item.entityId));
    }
    await tx.delete(ImportFile).where(eq(ImportFile.batchId, batchId));
    await tx
      .delete(ImportBatchItem)
      .where(eq(ImportBatchItem.batchId, batchId));
    await tx
      .update(ImportBatch)
      .set({ status: "undone", undoneAt: new Date() })
      .where(eq(ImportBatch.id, batchId));
  });
  return { removed: items.filter((item) => item.action === "added").length };
}

/** A failure on the way marks the batch; what's written can still be undone. */
export async function runImport(db: Database, batchId: string) {
  const batch = await db.query.ImportBatch.findFirst({
    where: eq(ImportBatch.id, batchId),
  });
  if (!batch?.options || batch.status !== "applying") return;
  try {
    const totals = await applyTable(db, batchId, batch.options);
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
    await db
      .update(ImportBatch)
      .set({ status: "failed" })
      .where(eq(ImportBatch.id, batchId));
    throw error;
  }
}

/** Files past their term, and drafts nobody finished. */
export async function cleanupImports(db: Database, now = new Date()) {
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

import { type Database, eq, ImportFile } from "@synoro/db";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long the file stays for the rows that failed. */
const IMPORT_FILE_DAYS = 7;

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

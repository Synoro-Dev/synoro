import { type Database, eq, ImportBatch } from "@synoro/db";

import { findOwnedPractice } from "./data-access";

/** The batch if `userId` owns its practice. */
export async function findOwnedBatch(
  db: Database,
  batchId: string,
  userId: string,
) {
  const batch = await db.query.ImportBatch.findFirst({
    where: eq(ImportBatch.id, batchId),
  });
  if (!batch) return undefined;
  const owned = await findOwnedPractice(db, batch.practiceId, userId);
  return owned ? batch : undefined;
}

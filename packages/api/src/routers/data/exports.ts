import { DataExport, desc, eq } from "@synoro/db";

import { dataProcedure } from "../../lib/data-access";

/**
 * The caller's latest archives. A ready one whose link ran out reads as
 * expired, even before the cleanup got to its file.
 *
 * @example client.data.exports()
 */
export const exports_ = dataProcedure.handler(async ({ context }) => {
  const rows = await context.db
    .select({
      id: DataExport.id,
      kind: DataExport.kind,
      status: DataExport.status,
      sizeBytes: DataExport.sizeBytes,
      expiresAt: DataExport.expiresAt,
      createdAt: DataExport.createdAt,
    })
    .from(DataExport)
    .where(eq(DataExport.userId, context.session.user.id))
    .orderBy(desc(DataExport.createdAt))
    .limit(10);
  const now = new Date();
  return rows.map((row) => ({
    ...row,
    status:
      row.status === "ready" && row.expiresAt && row.expiresAt <= now
        ? ("expired" as const)
        : row.status,
  }));
});

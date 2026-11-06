import { and, desc, eq, ImportBatch, ne } from "@synoro/db";
import { z } from "zod";

import { dataProcedure, findOwnedPractice } from "../../lib/data-access";

/**
 * The practice's imports, latest first; drafts nobody finished are left out.
 *
 * @example client.import.list({ practiceId })
 */
export const list = dataProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const owned = await findOwnedPractice(
      context.db,
      input.practiceId,
      user.id,
    );
    if (!owned) throw errors.FORBIDDEN();

    return context.db
      .select({
        id: ImportBatch.id,
        source: ImportBatch.source,
        status: ImportBatch.status,
        fileName: ImportBatch.fileName,
        totals: ImportBatch.totals,
        rowCount: ImportBatch.rowCount,
        progress: ImportBatch.progress,
        createdAt: ImportBatch.createdAt,
      })
      .from(ImportBatch)
      .where(
        and(
          eq(ImportBatch.practiceId, owned.id),
          ne(ImportBatch.status, "draft"),
          ne(ImportBatch.status, "expired"),
        ),
      )
      .orderBy(desc(ImportBatch.createdAt))
      .limit(20);
  });

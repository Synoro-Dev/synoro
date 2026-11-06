import { and, eq, ImportBatch, inArray } from "@synoro/db";
import { recordDataAudit } from "@synoro/jobs/data-export";
import { undoImport } from "@synoro/jobs/data-import";
import { z } from "zod";

import { dataProcedure } from "../../lib/data-access";
import { findOwnedBatch } from "../../lib/imports";

/**
 * «Отменить этот импорт»: removes exactly what this batch added and puts back
 * what it filled in on existing cards.
 *
 * @example client.import.undo({ batchId })
 */
export const undo = dataProcedure
  .errors({
    NOT_FOUND: { message: "Загрузка не найдена" },
    NOT_APPLIED: { message: "Эта загрузка не применена или уже отменена" },
  })
  .input(z.object({ batchId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const batch = await findOwnedBatch(context.db, input.batchId, user.id);
    if (!batch) throw errors.NOT_FOUND();

    const open = await context.db.query.ImportBatch.findFirst({
      where: and(
        eq(ImportBatch.id, batch.id),
        inArray(ImportBatch.status, ["applied", "failed"]),
      ),
      columns: { id: true },
    });
    if (!open) throw errors.NOT_APPLIED();

    const { removed } = await undoImport(context.db, batch.id);
    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      practiceId: batch.practiceId,
      action: "import_undone",
      details: { removed },
    });
    return { removed };
  });

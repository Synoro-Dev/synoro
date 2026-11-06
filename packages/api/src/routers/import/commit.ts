import { and, eq, ImportBatch } from "@synoro/db";
import { dispatchImport } from "@synoro/jobs";
import { recordDataAudit } from "@synoro/jobs/data-export";
import { z } from "zod";

import { dataProcedure } from "../../lib/data-access";
import { findOwnedBatch } from "../../lib/imports";
import { mappingSchema } from "./preview";

/**
 * Write the import, in the background if it's big. Nobody is told anything:
 * the cards have no accounts, and mail only goes to accounts. `consent` is the
 * specialist's word that they may keep these people's data: they are the
 * operator, and these people left it elsewhere, not at their booking.
 *
 * @example client.import.commit({ batchId, mapping, duplicates: "skip", importNotes: false, consent: true })
 */
export const commit = dataProcedure
  .errors({
    NOT_FOUND: { message: "Загрузка не найдена или её срок вышел" },
    ALREADY_APPLIED: { message: "Этот файл уже загружен" },
  })
  .input(
    z.object({
      batchId: z.uuid(),
      mapping: mappingSchema,
      duplicates: z.enum(["merge", "skip"]),
      importNotes: z.boolean(),
      consent: z.literal(true),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const batch = await findOwnedBatch(context.db, input.batchId, user.id);
    if (!batch) throw errors.NOT_FOUND();

    const [claimed] = await context.db
      .update(ImportBatch)
      .set({
        status: "applying",
        progress: 0,
        options: {
          mapping: input.mapping,
          duplicates: input.duplicates,
          importNotes: input.importNotes,
        },
      })
      .where(and(eq(ImportBatch.id, batch.id), eq(ImportBatch.status, "draft")))
      .returning({ id: ImportBatch.id });
    if (!claimed) throw errors.ALREADY_APPLIED();

    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      practiceId: batch.practiceId,
      action: "import_applied",
      details: { rows: batch.rowCount, source: batch.source },
    });
    await dispatchImport(context.db, batch.id, batch.rowCount);

    const after = await context.db.query.ImportBatch.findFirst({
      where: eq(ImportBatch.id, batch.id),
      columns: { status: true, totals: true },
    });
    return { id: batch.id, status: after?.status, totals: after?.totals };
  });

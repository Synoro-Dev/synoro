import { loadImportFile, rejectedCsv } from "@synoro/jobs/data-import";
import { z } from "zod";

import { dataProcedure } from "../../lib/data-access";
import { findOwnedBatch } from "../../lib/imports";
import { mappingSchema } from "./preview";

/**
 * The rows that can't go in, with the reason in a column of their own: a table
 * to fix and upload again. A mapping for a draft; an applied batch has its own.
 *
 * @example client.import.rejected({ batchId })
 */
export const rejected = dataProcedure
  .errors({
    NOT_FOUND: { message: "Срок хранения файла вышел" },
  })
  .input(z.object({ batchId: z.uuid(), mapping: mappingSchema.optional() }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const batch = await findOwnedBatch(context.db, input.batchId, user.id);
    const mapping = input.mapping ?? batch?.options?.mapping;
    if (!batch || !mapping) throw errors.NOT_FOUND();
    const file = await loadImportFile(context.db, batch.id);
    if (!file) throw errors.NOT_FOUND();

    return {
      csv: rejectedCsv(file, mapping),
      filename: `errors-${batch.fileName.replace(/\.[^.]+$/, "")}.csv`,
    };
  });

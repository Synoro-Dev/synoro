import {
  analyzeRows,
  loadExisting,
  loadImportFile,
  readTable,
} from "@synoro/jobs/data-import";
import { IMPORT_FIELDS } from "@synoro/validators";
import { z } from "zod";

import { dataProcedure } from "../../lib/data-access";
import { findOwnedBatch } from "../../lib/imports";

const SAMPLES = 100;

/** What each column means; null leaves it out. */
export const mappingSchema = z
  .array(z.enum(IMPORT_FIELDS).nullable())
  .max(200)
  .refine(
    (mapping) =>
      mapping.includes("name") ||
      mapping.includes("firstName") ||
      mapping.includes("lastName"),
    { message: "Выберите колонку с именем" },
  );

/**
 * What the import would do, before anything is written: how many clients are
 * new, who's a duplicate of whom, which rows can't go in and why.
 *
 * @example client.import.preview({ batchId, mapping })
 */
export const preview = dataProcedure
  .errors({
    NOT_FOUND: { message: "Загрузка не найдена или её срок вышел" },
  })
  .input(z.object({ batchId: z.uuid(), mapping: mappingSchema }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const batch = await findOwnedBatch(context.db, input.batchId, user.id);
    if (!batch) throw errors.NOT_FOUND();
    const file = await loadImportFile(context.db, batch.id);
    if (!file) throw errors.NOT_FOUND();

    const results = analyzeRows(
      readTable(file),
      input.mapping,
      await loadExisting(context.db, batch.practiceId),
    );
    const duplicates = results.flatMap((row) =>
      row.status === "duplicate" ? [row] : [],
    );
    const failed = results.flatMap((row) =>
      row.status === "error" ? [row] : [],
    );

    return {
      added: results.filter((row) => row.status === "new").length,
      duplicates: {
        total: duplicates.length,
        /** Clients with a cabinet: their contacts are theirs, always skipped. */
        members: duplicates.filter((row) => row.match.kind === "member").length,
        samples: duplicates.slice(0, SAMPLES).map((row) => ({
          line: row.line,
          name: row.client.name,
          by: row.by,
          kind: row.match.kind,
        })),
      },
      errors: {
        total: failed.length,
        samples: failed.slice(0, SAMPLES).map((row) => ({
          line: row.line,
          reasons: row.reasons,
        })),
      },
      notes: results.filter(
        (row) =>
          (row.status === "new" || row.status === "duplicate") &&
          row.client.note !== null,
      ).length,
    };
  });

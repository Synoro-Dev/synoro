import { and, count, eq, gt, ImportBatch } from "@synoro/db";
import {
  detectKind,
  FileProblem,
  MAX_FILE_BYTES,
  readTable,
  saveImportFile,
} from "@synoro/jobs/data-import";
import { suggestMapping } from "@synoro/validators";
import { z } from "zod";

import { dataProcedure, findOwnedPractice } from "../../lib/data-access";

const UPLOADS_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SAMPLE_ROWS = 5;

/**
 * Take a file for import: nothing is written but the draft. Its kind is read
 * from the bytes, whatever it's called. Returns the columns with their guessed
 * meaning, and a few rows to judge by. Its content is never logged.
 *
 * @example client.import.upload({ practiceId, file })
 */
export const upload = dataProcedure
  .errors({
    FILE_PROBLEM: { message: "Не получилось прочитать файл" },
    TOO_MANY_UPLOADS: {
      message: `Не больше ${UPLOADS_PER_DAY} загрузок в сутки. Попробуйте завтра`,
    },
  })
  .input(z.object({ practiceId: z.uuid(), file: z.file() }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const practice = await findOwnedPractice(
      context.db,
      input.practiceId,
      user.id,
    );
    if (!practice) throw errors.FORBIDDEN();

    const [today] = await context.db
      .select({ value: count() })
      .from(ImportBatch)
      .where(
        and(
          eq(ImportBatch.practiceId, practice.id),
          gt(ImportBatch.createdAt, new Date(Date.now() - DAY_MS)),
        ),
      );
    if ((today?.value ?? 0) >= UPLOADS_PER_DAY) throw errors.TOO_MANY_UPLOADS();

    if (input.file.size > MAX_FILE_BYTES) {
      throw errors.FILE_PROBLEM({
        message: "Файл больше 10 МБ. Разделите его на несколько",
      });
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());

    let table: ReturnType<typeof readTable>;
    try {
      detectKind(bytes);
      table = readTable(bytes);
    } catch (error) {
      if (error instanceof FileProblem) {
        throw errors.FILE_PROBLEM({ message: error.message });
      }
      throw error;
    }

    const [batch] = await context.db
      .insert(ImportBatch)
      .values({
        practiceId: practice.id,
        createdById: user.id,
        source: "table",
        fileName: input.file.name.slice(0, 255),
        rowCount: table.rows.length,
      })
      .returning({ id: ImportBatch.id });
    if (!batch) throw new Error("Failed to insert import batch");
    await saveImportFile(context.db, batch.id, bytes);

    return {
      id: batch.id,
      headers: table.headers,
      sample: table.rows.slice(0, SAMPLE_ROWS),
      mapping: suggestMapping(table.headers),
      rowCount: table.rows.length,
      encoding: table.encoding,
      delimiter: table.delimiter,
    };
  });

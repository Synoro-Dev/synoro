import { db } from "@synoro/db";

import { runImport } from "../data-import/apply";
import { hatchet } from "./client";

/**
 * Writes a big import. The input is the batch's id and nothing else; a rerun
 * finds what it already wrote and doesn't add it twice.
 *
 * Enqueue it through `dispatchImport` from `@synoro/jobs`.
 */
export const dataImportTask = hatchet.task({
  name: "data-import",
  retries: 1,
  executionTimeout: "600s",
  fn: async (rawInput) => {
    const { batchId } = rawInput as unknown as { batchId: string };
    await runImport(db, batchId);
    return { batchId };
  },
});

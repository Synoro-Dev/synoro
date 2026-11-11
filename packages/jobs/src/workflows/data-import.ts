import { db } from "@synoro/db";

import { runImport } from "../data-import/apply";
import { hatchet } from "./client";

const RETRIES = 1;

/**
 * Writes a big import. The input is the batch's id and nothing else; a rerun
 * skips what it already wrote. Only the last attempt marks the batch as failed:
 * until then it stays open for the retry.
 *
 * Enqueue it through `dispatchImport` from `@synoro/jobs`.
 */
export const dataImportTask = hatchet.task({
  name: "data-import",
  retries: RETRIES,
  executionTimeout: "600s",
  fn: async (rawInput, ctx) => {
    const { batchId } = rawInput as unknown as { batchId: string };
    await runImport(db, batchId, { final: ctx.retryCount() >= RETRIES });
    return { batchId };
  },
});

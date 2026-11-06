import { db } from "@synoro/db";

import {
  cleanupDataExports,
  runClientBackups,
  runDataExport,
} from "../data-export";
import { cleanupImports } from "../data-import/apply";
import { hatchet } from "./client";

/**
 * Builds one archive. The input is the row's id and nothing else: task inputs
 * stay in Hatchet, and the data of a psychologist's clients must not.
 *
 * Enqueue it through `dispatchDataExport` from `@synoro/jobs`.
 */
export const dataExportTask = hatchet.task({
  name: "data-export",
  retries: 2,
  backoff: { factor: 2, maxSeconds: 120 },
  executionTimeout: "300s",
  fn: async (rawInput) => {
    const { exportId } = rawInput as unknown as { exportId: string };
    await runDataExport(db, exportId);
    return { exportId };
  },
});

/** Hourly: deletes archives whose link ran out, gives up on stuck tasks. */
export const dataExportsCleanupWorkflow = hatchet.workflow({
  name: "data-exports-cleanup",
  on: { cron: "12 * * * *" },
});

dataExportsCleanupWorkflow.task({
  name: "cleanup-data-exports",
  retries: 2,
  executionTimeout: "120s",
  fn: async () => {
    await cleanupDataExports(db);
    await cleanupImports(db);
  },
});

/**
 * The weekly copies of client bases. Runs daily at 06:00 Moscow time: each run
 * takes whoever is due, longest waiting first, so a big week spills over into
 * the next day rather than skipping anyone.
 */
export const clientBackupWorkflow = hatchet.workflow({
  name: "client-backup",
  on: { cron: "0 3 * * *" },
});

clientBackupWorkflow.task({
  name: "run-client-backups",
  retries: 1,
  executionTimeout: "600s",
  fn: async () => {
    await runClientBackups(db);
  },
});

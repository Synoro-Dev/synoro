import { env, logger } from "@synoro/config";
import type { Database } from "@synoro/db";
import { sendTemplateEmail, type TemplateEmail } from "@synoro/emails";

export { newPracticeNotice, newUserNotice } from "./team-notice";

/**
 * App-facing entry of `@synoro/jobs`: safe to import whether or not Hatchet is
 * configured. The Hatchet client (`./workflows`) is loaded lazily, only when
 * HATCHET_CLIENT_TOKEN is set — creating it without a token throws.
 */

/** Whether background work goes to Hatchet (HATCHET_CLIENT_TOKEN is set). */
export const jobsEnabled = Boolean(env.HATCHET_CLIENT_TOKEN);

/**
 * Sends a template email via the `send-email` Hatchet task (durable, with
 * retries) when Hatchet is configured; otherwise — or if enqueueing fails —
 * sends it right away in this process. Says what happened: `"queued"` (the
 * worker sends it later, and may still fail), `"sent"`, or `"skipped"` (no
 * mail provider is configured here, nothing went out).
 */
export async function sendOrQueueEmail(
  message: TemplateEmail,
): Promise<"queued" | "sent" | "skipped"> {
  if (jobsEnabled) {
    try {
      const { sendEmailTask } = await import("./workflows/send-email");
      await sendEmailTask.runNoWait(message);
      return "queued";
    } catch (error) {
      logger.warn("jobs.enqueue_failed", {
        task: "send-email",
        template: message.template,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return sendTemplateEmail(message);
}

/** `sendOrQueueEmail` for callers that don't need to know what happened. */
export async function dispatchEmail(message: TemplateEmail): Promise<void> {
  await sendOrQueueEmail(message);
}

/** A table this long goes to the worker; a shorter one is written right away. */
const IMPORT_INLINE_ROWS = 1000;

/**
 * Writes an import. A big one goes to the background when Hatchet is
 * configured. Its input is the batch's id: the rows stay out of Hatchet.
 */
export async function dispatchImport(
  db: Database,
  batchId: string,
  rowCount: number,
): Promise<void> {
  if (jobsEnabled && rowCount > IMPORT_INLINE_ROWS) {
    try {
      const { dataImportTask } = await import("./workflows/data-import");
      await dataImportTask.runNoWait({ batchId });
      return;
    } catch (error) {
      logger.warn("jobs.enqueue_failed", {
        task: "data-import",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { runImport } = await import("./data-import/apply");
  await runImport(db, batchId).catch(() => {
    // Marked as failed on the batch, where the specialist sees it.
  });
}

/**
 * Builds a data archive in the background when Hatchet is configured;
 * otherwise, or if enqueueing fails, right here. A failure here only marks the
 * row: the specialist sees it in the settings and asks again.
 */
export async function dispatchDataExport(
  db: Database,
  exportId: string,
): Promise<void> {
  if (jobsEnabled) {
    try {
      const { dataExportTask } = await import("./workflows/data-export");
      await dataExportTask.runNoWait({ exportId });
      return;
    } catch (error) {
      logger.warn("jobs.enqueue_failed", {
        task: "data-export",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { runDataExport } = await import("./data-export/run");
  await runDataExport(db, exportId).catch((error: unknown) =>
    logger.warn("data_export.failed", {
      exportId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

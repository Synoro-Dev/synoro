import { env, logger } from "@synoro/config";
import { sendTemplateEmail, type TemplateEmail } from "@synoro/emails";

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
 * sends it right away in this process.
 */
export async function dispatchEmail(message: TemplateEmail): Promise<void> {
  if (jobsEnabled) {
    try {
      const { sendEmailTask } = await import("./workflows/send-email");
      await sendEmailTask.runNoWait(message);
      return;
    } catch (error) {
      logger.warn("jobs.enqueue_failed", {
        task: "send-email",
        template: message.template,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await sendTemplateEmail(message);
}

/**
 * Builds a data archive in the background when Hatchet is configured;
 * otherwise, or if enqueueing fails, right here. A failure here only marks the
 * row: the specialist sees it in the settings and asks again.
 */
export async function dispatchDataExport(exportId: string): Promise<void> {
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

  const [{ db }, { runDataExport }] = await Promise.all([
    import("@synoro/db"),
    import("./data-export/run"),
  ]);
  await runDataExport(db, exportId).catch((error: unknown) =>
    logger.warn("data_export.failed", {
      exportId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

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

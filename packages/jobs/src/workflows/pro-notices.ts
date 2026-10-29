import { db } from "@synoro/db";
import { sendProNotices } from "../pro-notices";
import { hatchet } from "./client";

/**
 * Tells specialists that their «Про» runs out (16 and 3 days ahead) and that
 * it ended. Hourly: `sent_notices` records successful delivery and lets
 * crashed workers' claims expire for a later attempt.
 */
export const proNoticesWorkflow = hatchet.workflow({
  name: "pro-notices",
  on: { cron: "0 * * * *" },
});

proNoticesWorkflow.task({
  name: "send-pro-notices",
  retries: 2,
  executionTimeout: "120s",
  fn: async () => {
    await sendProNotices(db);
  },
});

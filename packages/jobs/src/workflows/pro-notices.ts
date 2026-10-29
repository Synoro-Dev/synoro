import { db } from "@synoro/db";
import { sendProNotices } from "../pro-notices";
import { hatchet } from "./client";

/**
 * Tells specialists that their «Про» runs out (14 days ahead for a paid
 * year, 3 days ahead) and that it ended. Hourly: the notice windows are days
 * long, and the claims in `sent_notices` keep each notice to one mail.
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

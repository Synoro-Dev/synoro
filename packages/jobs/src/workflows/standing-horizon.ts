import { env, logger } from "@synoro/config";
import { hatchet } from "./client";

/**
 * Moves every standing time's horizon («Про»): makes the next dates, pays
 * held ones from new credits, lets unpaid holds go and mails the reminders.
 * Once a day, 04:00 UTC (07:00 Moscow). The work itself needs the API's
 * libraries, which this package cannot import (the API depends on it), so
 * the worker asks the app to run it: `POST /api/cron/standing` with the
 * shared `CRON_SECRET`. Safe to repeat: every date and every notice is made
 * once.
 */
export const standingHorizonWorkflow = hatchet.workflow({
  name: "standing-horizon",
  on: { cron: "0 4 * * *" },
});

standingHorizonWorkflow.task({
  name: "run-standing-horizon",
  retries: 2,
  executionTimeout: "300s",
  fn: async () => {
    if (!env.CRON_SECRET) {
      logger.warn("standing.cron_skipped", {
        reason: "CRON_SECRET is not set",
      });
      return;
    }
    const response = await fetch(new URL("/api/cron/standing", env.APP_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    if (!response.ok) {
      throw new Error(`standing-horizon: the app answered ${response.status}`);
    }
  },
});

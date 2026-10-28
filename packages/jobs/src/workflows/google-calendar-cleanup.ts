import { db } from "@synoro/db";
import { reconcileGoogleCalendar } from "../google-calendar";
import { hatchet } from "./client";

/** Pending Google deletions survive request failures and worker restarts. */
export const googleCalendarCleanupWorkflow = hatchet.workflow({
  name: "google-calendar-cleanup",
  on: { cron: "*/5 * * * *" },
});

googleCalendarCleanupWorkflow.task({
  name: "delete-cancelled-events",
  retries: 2,
  executionTimeout: "120s",
  fn: async () => {
    await reconcileGoogleCalendar(db);
  },
});

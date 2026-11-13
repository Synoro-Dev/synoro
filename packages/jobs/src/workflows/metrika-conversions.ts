import { db } from "@synoro/db";
import { reportPaidConversions } from "../metrika";
import { hatchet } from "./client";

/**
 * Sends the first paid year (goal `paid_year`) and the first paid month (goal
 * `paid_month`) of every specialist who came from Yandex Direct to Metrika,
 * and before those their first practice (goal `practice_created`).
 * Hourly: the claim in `sent_notices` keeps each payment to one upload, and a
 * failed upload is tried again next hour.
 */
export const metrikaConversionsWorkflow = hatchet.workflow({
  name: "metrika-conversions",
  on: { cron: "15 * * * *" },
});

metrikaConversionsWorkflow.task({
  name: "report-paid-conversions",
  retries: 1,
  executionTimeout: "120s",
  fn: async () => {
    await reportPaidConversions(db);
  },
});

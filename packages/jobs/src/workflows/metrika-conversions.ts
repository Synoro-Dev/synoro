import { db } from "@synoro/db";
import { reportPaidYears } from "../metrika";
import { hatchet } from "./client";

/**
 * Sends the first paid year of every specialist who came from Yandex Direct
 * to Metrika (the goal `paid_year`). Hourly: the claim in `sent_notices` keeps
 * each payment to one upload, and a failed upload is tried again next hour.
 */
export const metrikaConversionsWorkflow = hatchet.workflow({
  name: "metrika-conversions",
  on: { cron: "15 * * * *" },
});

metrikaConversionsWorkflow.task({
  name: "report-paid-years",
  retries: 1,
  executionTimeout: "120s",
  fn: async () => {
    await reportPaidYears(db);
  },
});

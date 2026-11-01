import { db } from "@synoro/db";
import { renewSubscriptions } from "../billing-renewal";
import { hatchet } from "./client";

/**
 * Charges the cards of specialists with auto-renewal for the next «Про»
 * period a day before the paid one ends. Hourly: the attempt row in
 * `subscription_payments` (unique per user and period end) keeps a period
 * from being charged twice, however often this runs or retries.
 */
export const billingRenewalsWorkflow = hatchet.workflow({
  name: "billing-renewals",
  on: { cron: "30 * * * *" },
});

billingRenewalsWorkflow.task({
  name: "renew-subscriptions",
  // A repeat is safe (the attempt row), but a charge shouldn't be hurried.
  retries: 1,
  executionTimeout: "300s",
  fn: async () => {
    await renewSubscriptions(db);
  },
});

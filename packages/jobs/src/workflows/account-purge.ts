import { db } from "@synoro/db";

import { purgeDueAccounts } from "../account-deletion";
import { hatchet } from "./client";

/**
 * Deletes for good the accounts whose 30 days are over. Daily at 05:30 Moscow
 * time; one that fails stays due and is tried again.
 */
export const accountPurgeWorkflow = hatchet.workflow({
  name: "account-purge",
  on: { cron: "30 2 * * *" },
});

accountPurgeWorkflow.task({
  name: "purge-accounts",
  retries: 1,
  executionTimeout: "600s",
  fn: async () => {
    await purgeDueAccounts(db);
  },
});

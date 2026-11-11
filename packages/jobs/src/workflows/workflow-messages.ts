import { db } from "@synoro/db";
import { sendWorkflowMessages } from "../workflow-messages";
import { hatchet } from "./client";

/**
 * Sends the specialists' own messages to clients (rules from «Про»):
 * after a meeting, a package running out, a client who went quiet. Every ten
 * minutes: the claims in `sent_notices` keep each message to one mail, and
 * the rules reach back far enough to catch up after downtime.
 */
export const workflowMessagesWorkflow = hatchet.workflow({
  name: "workflow-messages",
  on: { cron: "*/10 * * * *" },
});

workflowMessagesWorkflow.task({
  name: "send-workflow-messages",
  retries: 2,
  executionTimeout: "120s",
  fn: async () => {
    await sendWorkflowMessages(db);
  },
});

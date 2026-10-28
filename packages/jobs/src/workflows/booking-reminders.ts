import { db } from "@synoro/db";
import { sendVideoReminders } from "../booking-video";
import { hatchet } from "./client";

/**
 * Reminds clients of video meetings 24 hours and 1 hour ahead, with the link.
 * Every 5 minutes: the reminder marks on the booking keep it to one each.
 */
export const bookingRemindersWorkflow = hatchet.workflow({
  name: "booking-reminders",
  on: { cron: "*/5 * * * *" },
});

bookingRemindersWorkflow.task({
  name: "send-video-reminders",
  retries: 2,
  executionTimeout: "120s",
  fn: async () => {
    await sendVideoReminders(db);
  },
});

import { db } from "@synoro/db";
import { sendBookingReminders } from "../booking-video";
import { hatchet } from "./client";

/**
 * Reminds clients of their bookings 24 hours and 1 hour ahead, with the video
 * link when there is one. Every 5 minutes: the reminder marks on the booking
 * keep it to one each.
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
    await sendBookingReminders(db);
  },
});

import { db } from "@synoro/db";
import { sendStaffAgendas } from "../staff-agenda";
import { hatchet } from "./client";

/**
 * Sends the specialist and the administrators tomorrow's bookings at 20:00,
 * practice time. Every 15 minutes: practices sit in different time zones,
 * and the claims in `sent_notices` keep it to one summary a day each.
 */
export const staffAgendaWorkflow = hatchet.workflow({
  name: "staff-agenda",
  on: { cron: "*/15 * * * *" },
});

staffAgendaWorkflow.task({
  name: "send-staff-agendas",
  retries: 2,
  executionTimeout: "120s",
  fn: async () => {
    await sendStaffAgendas(db);
  },
});

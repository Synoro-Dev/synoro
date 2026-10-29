/**
 * Hatchet client and task declarations (`@synoro/jobs/workflows`).
 *
 * Importing this module creates the Hatchet client, which throws without
 * HATCHET_CLIENT_TOKEN. App code should go through `@synoro/jobs` instead.
 */
export { bookingRemindersWorkflow } from "./booking-reminders";
export { hatchet } from "./client";
export { googleCalendarCleanupWorkflow } from "./google-calendar-cleanup";
export type { HelloWorldInput } from "./hello-world";
export { helloWorldTask } from "./hello-world";
export type { ProcessDocumentInput } from "./multi-step";
export { processDocumentWorkflow } from "./multi-step";
export { proNoticesWorkflow } from "./pro-notices";
export { scheduledWorkflow } from "./scheduled";
export { sendEmailTask } from "./send-email";

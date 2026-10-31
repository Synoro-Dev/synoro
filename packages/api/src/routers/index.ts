/**
 * Root Router
 *
 * The single entry-point for the entire oRPC API.
 * Add new domain routers here and they become available everywhere
 * (Next.js handler, RSC clients, type-safe hooks, etc.).
 *
 * Current route map:
 *
 *   user.*          – current user profile & account settings  (protected)
 *   post.list       – paginated list of posts                  (public)
 *   post.byId       – single post by UUID                      (public)
 *   post.create     – create a post                            (protected)
 *   post.delete     – delete a post                            (admin)
 *   admin.users.*   – user management                          (admin)
 *   admin.stats.*   – system-wide statistics                   (admin)
 *
 *   Booking (multi-tenant: access is checked per practice membership)
 *   practice.*      – create a practice, join it, members      (protected / public bySlug, byHost)
 *   availability.*  – weekly working hours                     (public list, staff replace)
 *   booking.*       – slots, book, free consults, blocks, cancel, calendar
 *   credit.*        – paid consultation balance + history      (staff grant)
 *   domain.*        – own domain for the booking page          (owner)
 *   billing.*       – the specialist's «Про» plan: trial, paid period,
 *                     payment via Точка Банк              (protected)
 *   payment.*       – ЮKassa / Т-Банк: setup (owner), packages, client
 *                     checkout + status, payment history (client / staff)
 *   workflow.*      – own messages to clients on «Про»: after a meeting,
 *                     package running out, quiet client            (owner)
 *   analytics.*     – how the practice is doing: meetings, no-shows,
 *                     online revenue, clients, busy hours      (owner, «Про»)
 *   googleCalendar.* – link the specialist's Google Calendar (owner), its
 *                     busy time on the practice calendar (staff)
 */

import { adminRouter } from "./admin";
import { analyticsRouter } from "./analytics";
import { availabilityRouter } from "./availability";
import { billingRouter } from "./billing";
import { bookingRouter } from "./booking";
import { creditRouter } from "./credit";
import { domainRouter } from "./domain";
import { googleCalendarRouter } from "./google-calendar";
import { paymentRouter } from "./payment";
import { postRouter } from "./post";
import { practiceRouter } from "./practice";
import { userRouter } from "./user";
import { workflowRouter } from "./workflow";

export const appRouter = {
  user: userRouter,
  post: postRouter,
  admin: adminRouter,
  practice: practiceRouter,
  availability: availabilityRouter,
  booking: bookingRouter,
  credit: creditRouter,
  domain: domainRouter,
  payment: paymentRouter,
  billing: billingRouter,
  googleCalendar: googleCalendarRouter,
  workflow: workflowRouter,
  analytics: analyticsRouter,
};

export type AppRouter = typeof appRouter;

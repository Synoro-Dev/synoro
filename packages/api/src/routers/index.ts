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
 *   payment.*       – ЮKassa / Т-Банк: setup (owner), packages, client
 *                     checkout + status, payment history (client / staff)
 *   googleCalendar.* – link the specialist's Google Calendar (owner), its
 *                     busy time on the practice calendar (staff)
 */

import { adminRouter } from "./admin";
import { availabilityRouter } from "./availability";
import { bookingRouter } from "./booking";
import { creditRouter } from "./credit";
import { domainRouter } from "./domain";
import { googleCalendarRouter } from "./google-calendar";
import { paymentRouter } from "./payment";
import { postRouter } from "./post";
import { practiceRouter } from "./practice";
import { userRouter } from "./user";

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
  googleCalendar: googleCalendarRouter,
};

export type AppRouter = typeof appRouter;

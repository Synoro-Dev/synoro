import { and, asc, Booking, BookingSeries, eq, gt } from "@synoro/db";
import { notifySeriesCancelled } from "@synoro/jobs/booking-video";
import { z } from "zod";

import { cancelActiveBooking } from "../../lib/bookings";
import { findMembership, isStaff } from "../../lib/practice-access";
import { CLIENT_CANCEL_WINDOW_MS } from "../../lib/schedule";
import { protectedProcedure } from "../../orpc";

/**
 * Cancel the upcoming bookings of a recurring booking, one by one under the
 * rules of `booking.cancel`:
 *
 * - the client cancels the ones more than 24 h ahead and gets their credits
 *   back; the nearer ones stay (`kept`) — refusing the whole series would
 *   leave them unable to stop it at all;
 * - staff cancel all upcoming ones, refunding unless `refund: false`.
 *
 * Past bookings are left alone. One mail tells the client and the staff
 * about all the cancelled dates. A series the caller may not touch is
 * NOT_FOUND.
 *
 * @example client.booking.cancelSeries({ seriesId })
 */
export const cancelSeries = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Повторная запись не найдена" },
  })
  .input(
    z.object({
      seriesId: z.uuid(),
      /** Staff only: return the consultations to the client's balance. */
      refund: z.boolean().default(true),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const series = await context.db.query.BookingSeries.findFirst({
      where: eq(BookingSeries.id, input.seriesId),
    });
    if (!series) throw errors.NOT_FOUND();
    const caller = await findMembership(context.db, series.practiceId, userId);
    const staff = caller !== undefined && isStaff(caller.role);
    const own = caller !== undefined && series.memberId === caller.id;
    if (!staff && !own) throw errors.NOT_FOUND();

    const now = Date.now();
    const upcoming = await context.db
      .select({ id: Booking.id, startsAt: Booking.startsAt })
      .from(Booking)
      .where(
        and(
          eq(Booking.seriesId, series.id),
          eq(Booking.status, "active"),
          gt(Booking.startsAt, new Date(now)),
        ),
      )
      .orderBy(asc(Booking.startsAt));

    const cancelled: string[] = [];
    let refunded = 0;
    let kept = 0;
    for (const booking of upcoming) {
      if (
        !staff &&
        booking.startsAt.getTime() - now < CLIENT_CANCEL_WINDOW_MS
      ) {
        kept++;
        continue;
      }
      const result = await cancelActiveBooking(context.db, booking.id, {
        cancelledById: userId,
        refund: input.refund || !staff,
        reason: staff ? "staff" : "client",
        notify: false,
      });
      if (!result) continue;
      cancelled.push(booking.id);
      if (result.refunded) refunded++;
    }

    if (kept === 0) {
      await context.db
        .update(BookingSeries)
        .set({ cancelledAt: new Date() })
        .where(eq(BookingSeries.id, series.id));
    }
    if (cancelled.length > 0) {
      await notifySeriesCancelled(context.db, cancelled, {
        by: staff ? "staff" : "client",
        refunded: refunded > 0,
      });
    }

    return { cancelled: cancelled.length, refunded, kept };
  });

import { and, asc, Booking, eq, gt, StandingTime } from "@synoro/db";
import { notifySeriesCancelled } from "@synoro/jobs/booking-video";
import { notifyWaitlist } from "@synoro/jobs/waitlist";
import { clientCancel } from "@synoro/validators";
import { z } from "zod";

import { cancelBookingRows, loadCancelRules } from "../../lib/bookings";
import { removeBookingEvent } from "../../lib/google-calendar";
import { findMembership, isStaff } from "../../lib/practice-access";
import { protectedProcedure } from "../../orpc";

/**
 * End a standing time for good: nothing more is made for it, and its upcoming
 * dates are cancelled one by one under the rules of `booking.cancel`, as
 * `cancelSeries` does:
 *
 * - the client cancels what they may cancel alone with the credit back; nearer
 *   dates stay as ordinary bookings (`kept`); held dates simply go;
 * - staff cancel every upcoming date, refunding unless `refund: false`.
 *
 * One mail tells the client and the staff about the cancelled dates. A
 * standing time the caller may not touch is NOT_FOUND.
 *
 * @example client.standing.end({ standingId })
 */
export const end = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Постоянное время не найдено" },
  })
  .input(
    z.object({
      standingId: z.uuid(),
      /** Staff only: return the consultations to the client's balance. */
      refund: z.boolean().default(true),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const standing = await context.db.query.StandingTime.findFirst({
      where: eq(StandingTime.id, input.standingId),
    });
    if (!standing || standing.endedAt) throw errors.NOT_FOUND();
    const caller = await findMembership(
      context.db,
      standing.practiceId,
      userId,
    );
    const staff = caller !== undefined && isStaff(caller.role);
    const own = caller !== undefined && standing.memberId === caller.id;
    if (!staff && !own) throw errors.NOT_FOUND();

    const now = Date.now();
    const rules = await loadCancelRules(context.db, standing.practiceId);
    const done = await context.db.transaction(async (tx) => {
      // Ended first, which takes the standing time's lock: the cron makes
      // nothing more once it is held, and what it made before is read below.
      await tx
        .update(StandingTime)
        .set({ endedAt: new Date(now) })
        .where(eq(StandingTime.id, standing.id));
      const upcoming = await tx
        .select({
          id: Booking.id,
          kind: Booking.kind,
          credits: Booking.credits,
          startsAt: Booking.startsAt,
          holdUntil: Booking.holdUntil,
        })
        .from(Booking)
        .where(
          and(
            eq(Booking.standingId, standing.id),
            eq(Booking.status, "active"),
            gt(Booking.startsAt, new Date(now)),
          ),
        )
        .orderBy(asc(Booking.startsAt));
      const rows: Awaited<ReturnType<typeof cancelBookingRows>>[] = [];
      let kept = 0;
      for (const booking of upcoming) {
        // An unpaid hold is no booking to keep: it always goes with the
        // standing time, whatever the cancellation deadline says.
        if (
          !staff &&
          booking.holdUntil === null &&
          clientCancel(booking, now, rules) !== "refund"
        ) {
          kept++;
          continue;
        }
        const row = await cancelBookingRows(tx, booking.id, {
          cancelledById: userId,
          refund: input.refund || !staff,
          reason: staff ? "staff" : "client",
          startsAt: staff ? undefined : booking.startsAt,
        });
        rows.push(row);
      }
      return { rows: rows.filter((r) => r !== undefined), kept };
    });

    // After the commit: Google and mails never undo the cancellation.
    for (const { booking } of done.rows) {
      await removeBookingEvent(context.db, booking);
      await notifyWaitlist(context.db, {
        practiceId: booking.practiceId,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        exceptUserId: userId,
      });
    }
    // An unpaid hold was never told to the client as a booking: only the
    // confirmed dates are named in the mail.
    const confirmed = done.rows.filter((r) => r.booking.holdUntil === null);
    if (confirmed.length > 0) {
      await notifySeriesCancelled(
        context.db,
        confirmed.map((r) => r.booking.id),
        {
          by: staff ? "staff" : "client",
          refunded: confirmed.some((r) => r.refunded),
        },
      );
    }

    return {
      cancelled: done.rows.length,
      refunded: done.rows.filter((r) => r.refunded).length,
      kept: done.kept,
      /** The deadline the kept ones missed, for the message. */
      cancelHours: rules.cancelHours,
    };
  });

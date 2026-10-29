import { and, Booking, eq } from "@synoro/db";
import { z } from "zod";

import { cancelActiveBooking } from "../../lib/bookings";
import { findMembership, isStaff } from "../../lib/practice-access";
import { CLIENT_CANCEL_WINDOW_MS } from "../../lib/schedule";
import { protectedProcedure } from "../../orpc";

/**
 * Cancel a booking.
 *
 * - A client cancels their own consultation no later than 24 h before it
 *   starts and gets the credit back; later → TOO_LATE.
 * - Staff cancel anything at any time; a consultation's credit is returned
 *   unless `refund: false` (a late cancellation). A client who didn't come
 *   is marked with `markNoShow` instead.
 *
 * Bookings the caller may not touch are reported as NOT_FOUND.
 *
 * @example client.booking.cancel({ bookingId })
 */
export const cancel = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Запись не найдена или уже отменена" },
    TOO_LATE: {
      message:
        "Отменить запись можно не позднее чем за 24 часа до начала — обратитесь к администратору",
    },
  })
  .input(
    z.object({
      bookingId: z.uuid(),
      /** Staff only: return the consultation to the client's balance. */
      refund: z.boolean().default(true),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const booking = await context.db.query.Booking.findFirst({
      where: and(eq(Booking.id, input.bookingId), eq(Booking.status, "active")),
    });
    if (!booking) throw errors.NOT_FOUND();

    const caller = await findMembership(context.db, booking.practiceId, userId);
    const staff = caller !== undefined && isStaff(caller.role);
    const own =
      caller !== undefined &&
      booking.kind === "consultation" &&
      booking.memberId === caller.id;
    if (!staff && !own) throw errors.NOT_FOUND();

    if (
      !staff &&
      booking.startsAt.getTime() - Date.now() < CLIENT_CANCEL_WINDOW_MS
    ) {
      throw errors.TOO_LATE();
    }

    const result = await cancelActiveBooking(context.db, booking.id, {
      cancelledById: userId,
      refund: input.refund || !staff,
      reason: staff ? "staff" : "client",
    });
    if (!result) throw errors.NOT_FOUND();
    const { booking: cancelled, refunded: refund } = result;

    return { id: cancelled.id, kind: cancelled.kind, refunded: refund };
  });

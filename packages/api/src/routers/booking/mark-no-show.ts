import { and, Booking, eq } from "@synoro/db";
import { z } from "zod";

import { cancelActiveBooking } from "../../lib/bookings";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * «Клиент не пришёл» — staff only. Cancels a confirmed booking that has
 * already started with the `no_show` reason; the consultation is not given
 * back. Kept apart from a late cancellation so no-shows can be counted.
 *
 * NOT_STARTED before the booking's start; NOT_FOUND for free bookings,
 * blocks, unpaid holds, cancelled bookings and bookings of other practices.
 *
 * @example client.booking.markNoShow({ bookingId })
 */
export const markNoShow = practiceProcedure
  .errors({
    NOT_FOUND: { message: "Запись не найдена или уже отменена" },
    NOT_STARTED: {
      message: "Отметить неявку можно, когда время записи уже наступило",
    },
  })
  .input(z.object({ bookingId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const booking = await context.db.query.Booking.findFirst({
      where: and(eq(Booking.id, input.bookingId), eq(Booking.status, "active")),
    });
    if (booking?.kind !== "consultation" || booking.holdUntil !== null) {
      throw errors.NOT_FOUND();
    }
    const staff = await findStaffMembership(
      context.db,
      booking.practiceId,
      userId,
    );
    if (!staff) throw errors.NOT_FOUND();
    if (booking.startsAt.getTime() > Date.now()) throw errors.NOT_STARTED();

    const result = await cancelActiveBooking(context.db, booking.id, {
      cancelledById: userId,
      refund: false,
      reason: "no_show",
    });
    if (!result) throw errors.NOT_FOUND();
    return { id: result.booking.id, kind: result.booking.kind };
  });

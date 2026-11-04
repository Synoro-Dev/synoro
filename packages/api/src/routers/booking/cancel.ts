import { z } from "zod";

import { cancelBookingAs } from "../../lib/bookings";
import { protectedProcedure } from "../../orpc";

/**
 * Cancel a booking.
 *
 * - A client cancels their own consultation no later than 24 h before it
 *   starts and gets the credit back; later → TOO_LATE. Their free intro
 *   (`bookIntro`) — any time before it starts.
 * - Staff cancel anything at any time; a consultation's credit is returned
 *   unless `refund: false` (a late cancellation). A client who didn't come
 *   is marked with `markNoShow` instead.
 *
 * Bookings the caller may not touch are reported as NOT_FOUND. The rules
 * live in `cancelBookingAs`, shared with the messenger's «Отменить запись».
 *
 * @example client.booking.cancel({ bookingId })
 */
export const cancel = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Запись не найдена или уже отменена" },
    TOO_LATE: {
      message:
        "Отменить запись можно не позднее чем за 24 часа до начала — обратитесь к специалисту",
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
    const result = await cancelBookingAs(
      context.db,
      input.bookingId,
      context.session.user.id,
      { refund: input.refund },
    );
    if ("refusal" in result) throw errors[result.refusal]();
    const { booking, refunded } = result;
    return { id: booking.id, kind: booking.kind, refunded };
  });

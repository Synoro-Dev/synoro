import { z } from "zod";

import { cancelBookingAs, tooLateMessage } from "../../lib/bookings";
import { protectedProcedure } from "../../orpc";

/**
 * Cancel a booking.
 *
 * - A client cancels their own consultation by the practice's rules: up to
 *   `cancel_hours` before it with the credit back; later, if the practice
 *   allows late cancelling, only with `forfeit: true` (the credit is lost,
 *   `late_cancel`), else TOO_LATE. Their free intro (`bookIntro`) — any time
 *   before it starts.
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
      message: "Отменить запись уже нельзя — обратитесь к специалисту",
    },
  })
  .input(
    z.object({
      bookingId: z.uuid(),
      /** Staff only: return the consultation to the client's balance. */
      refund: z.boolean().default(true),
      /**
       * Client only: cancel after the deadline knowing the credit won't
       * come back, where the practice allows it.
       */
      forfeit: z.boolean().default(false),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const result = await cancelBookingAs(
      context.db,
      input.bookingId,
      context.session.user.id,
      { refund: input.refund, forfeit: input.forfeit },
    );
    if ("refusal" in result) {
      throw result.refusal === "TOO_LATE"
        ? errors.TOO_LATE({ message: tooLateMessage("cancel", result.rules) })
        : errors.NOT_FOUND();
    }
    const { booking, refunded } = result;
    return { id: booking.id, kind: booking.kind, refunded };
  });

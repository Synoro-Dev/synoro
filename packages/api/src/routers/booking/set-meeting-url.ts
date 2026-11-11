import { and, Booking, eq, ne } from "@synoro/db";
import { notifyVideoLinkChanged } from "@synoro/jobs/booking-video";
import { videoUrlSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Set (or clear, with an empty string) the video link of one booking. Staff
 * only. Without a link of its own a booking uses the practice's room. The
 * client of a confirmed upcoming consultation is mailed the link they now
 * have.
 *
 * @example client.booking.setMeetingUrl({ bookingId, meetingUrl: "https://acme.ktalk.ru/anna" })
 */
export const setMeetingUrl = practiceProcedure
  .errors({ NOT_FOUND: { message: "Запись не найдена или уже отменена" } })
  .input(z.object({ bookingId: z.uuid(), meetingUrl: videoUrlSchema }))
  .handler(async ({ context, input, errors }) => {
    const booking = await context.db.query.Booking.findFirst({
      where: and(
        eq(Booking.id, input.bookingId),
        eq(Booking.status, "active"),
        ne(Booking.kind, "blocked"),
      ),
    });
    const staff =
      booking &&
      (await findStaffMembership(
        context.db,
        booking.practiceId,
        context.session.user.id,
      ));
    if (!booking || !staff) throw errors.NOT_FOUND();

    await context.db
      .update(Booking)
      .set({ meetingUrl: input.meetingUrl })
      .where(eq(Booking.id, booking.id));

    if (
      input.meetingUrl !== booking.meetingUrl &&
      booking.kind === "consultation"
    ) {
      await notifyVideoLinkChanged(context.db, { bookingId: booking.id });
    }
    return { meetingUrl: input.meetingUrl };
  });

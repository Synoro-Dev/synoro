import { and, Booking, ne } from "@synoro/db";
import { z } from "zod";

import {
  activeBookingOverlaps,
  checkMove,
  loadRules,
  localDaysRange,
} from "../../lib/bookings";
import { googleBusyForMove } from "../../lib/google-calendar";
import { findPractice } from "../../lib/practice-access";
import { computeSlots } from "../../lib/schedule";
import { protectedProcedure } from "../../orpc";

/**
 * Where a booking can move: `booking.slots` as seen by this booking. The
 * times fit its own length, which may differ from the practice's intro now,
 * and its own time isn't busy, so an intro can shift by half an hour; its
 * current start is left out. Same access as `booking.reschedule`, unlike
 * `slots`, which is public and knows nothing of a booking.
 *
 * @example client.booking.rescheduleSlots({ bookingId, from: "2026-11-02", days: 7 })
 */
export const rescheduleSlots = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Запись не найдена или уже отменена" },
    TOO_LATE: {
      message:
        "Перенести запись можно не позднее чем за 24 часа до начала — обратитесь к специалисту",
    },
  })
  .input(
    z.object({
      bookingId: z.uuid(),
      from: z.iso.date(),
      days: z.number().int().min(1).max(35).default(7),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const check = await checkMove(
      context.db,
      input.bookingId,
      context.session.user.id,
    );
    if ("refusal" in check) throw errors[check.refusal]();
    const { booking, kind, minutes } = check;
    const practice = await findPractice(context.db, booking.practiceId);
    if (!practice) throw errors.NOT_FOUND();

    const { start, end } = localDaysRange(
      input.from,
      input.days,
      practice.timezone,
    );
    const [rules, booked, external] = await Promise.all([
      loadRules(context.db, practice.id),
      context.db
        .select({ startsAt: Booking.startsAt, endsAt: Booking.endsAt })
        .from(Booking)
        .where(
          and(
            activeBookingOverlaps(practice.id, start, end),
            ne(Booking.id, booking.id),
          ),
        ),
      googleBusyForMove(context.db, booking, start, end),
    ]);

    return {
      timezone: practice.timezone,
      slots: computeSlots({
        rules,
        busy: [...booked, ...external],
        from: input.from,
        days: input.days,
        timeZone: practice.timezone,
        kind,
        introMinutes: minutes,
        minutes,
        now: new Date(),
      }).filter(
        (slot) => slot.startsAt.getTime() !== booking.startsAt.getTime(),
      ),
    };
  });

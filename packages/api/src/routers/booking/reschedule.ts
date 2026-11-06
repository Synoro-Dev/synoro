import { and, Booking, eq, isExclusionViolation, isNull } from "@synoro/db";
import { notifyBookingMoved } from "@synoro/jobs/booking-video";
import { notifyWaitlist } from "@synoro/jobs/waitlist";
import { clientTimeZoneInput } from "@synoro/validators";
import { z } from "zod";

import { checkMove, loadRules, releaseExpiredHolds } from "../../lib/bookings";
import { googleBusyForMove, moveBookingEvent } from "../../lib/google-calendar";
import { findPractice } from "../../lib/practice-access";
import { isScheduledSlot, overlaps } from "../../lib/schedule";
import { protectedProcedure } from "../../orpc";

/**
 * Move a confirmed booking to another time. It stays the same booking — same
 * id, link, video room, series and length — and the balance doesn't change.
 *
 * The rules are those of `booking.cancel` (`checkMove`): a client moves
 * their own booking no later than 24 h before it starts (a free intro until
 * it starts), later → TOO_LATE; staff move anything at any time. Bookings the
 * caller may not touch, closed time and unpaid holds are NOT_FOUND. The times
 * to offer: `booking.rescheduleSlots`.
 *
 * SLOT_UNAVAILABLE when the new time is off the schedule, busy in the
 * specialist's Google Calendar (checked for clients only, as in `book`) or
 * taken: one UPDATE moves the booking and `bookings_no_overlap` decides races,
 * so a refused move leaves it where it was and the old time is freed only by a
 * move that succeeded. Of a series only this booking moves. The client and the
 * staff are told (not the one who moved it); the reminders start over.
 *
 * @example client.booking.reschedule({ bookingId, startsAt: new Date("2026-11-02T07:00:00Z") })
 */
export const reschedule = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Запись не найдена или уже отменена" },
    TOO_LATE: {
      message:
        "Перенести запись можно не позднее чем за 24 часа до начала — обратитесь к специалисту",
    },
    SLOT_UNAVAILABLE: {
      message: "Это время уже занято или недоступно — выберите другое",
    },
  })
  .input(
    z.object({
      bookingId: z.uuid(),
      startsAt: z.date(),
      /** The client's browser zone, for mails; not used when staff move. */
      timezone: clientTimeZoneInput,
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const check = await checkMove(context.db, input.bookingId, userId);
    if ("refusal" in check) throw errors[check.refusal]();
    const { booking, kind, staff, minutes } = check;
    // Already there (a repeated request): nothing to do, nobody to tell.
    if (booking.startsAt.getTime() === input.startsAt.getTime()) {
      return {
        id: booking.id,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
      };
    }

    const practice = await findPractice(context.db, booking.practiceId);
    if (!practice) throw errors.NOT_FOUND();

    const rules = await loadRules(context.db, practice.id);
    const scheduled = isScheduledSlot({
      rules,
      startsAt: input.startsAt,
      timeZone: practice.timezone,
      kind,
      introMinutes: minutes,
      minutes,
      now: new Date(),
    });
    if (!scheduled) throw errors.SLOT_UNAVAILABLE();
    const endsAt = new Date(input.startsAt.getTime() + minutes * 60_000);
    const range = { startsAt: input.startsAt, endsAt };
    if (!staff) {
      const busy = await googleBusyForMove(
        context.db,
        booking,
        range.startsAt,
        range.endsAt,
      );
      if (busy.some((b) => overlaps(b, range))) {
        throw errors.SLOT_UNAVAILABLE();
      }
    }

    await releaseExpiredHolds(context.db, practice.id);
    let moved: typeof Booking.$inferSelect | undefined;
    try {
      [moved] = await context.db
        .update(Booking)
        .set({
          ...range,
          reminderDaySentAt: null,
          reminderHourSentAt: null,
          // Staff's browser says nothing about the client's zone.
          clientTimezone: staff
            ? booking.clientTimezone
            : (input.timezone ?? booking.clientTimezone),
        })
        .where(
          and(
            eq(Booking.id, booking.id),
            eq(Booking.status, "active"),
            isNull(Booking.holdUntil),
            // Moved or cancelled since the check: its verdict is out of date.
            eq(Booking.startsAt, booking.startsAt),
          ),
        )
        .returning();
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
    if (!moved) throw errors.NOT_FOUND();

    await moveBookingEvent(context.db, moved);
    await notifyBookingMoved(context.db, moved.id, {
      from: booking.startsAt,
      movedById: userId,
    });
    // The time it left is free again for those waiting for one.
    await notifyWaitlist(context.db, {
      practiceId: booking.practiceId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      exceptUserId: userId,
    });

    return { id: moved.id, startsAt: moved.startsAt, endsAt: moved.endsAt };
  });

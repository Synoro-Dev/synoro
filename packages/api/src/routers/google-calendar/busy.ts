import { Booking } from "@synoro/db";
import { z } from "zod";

import { activeBookingOverlaps, localDaysRange } from "../../lib/bookings";
import { googleBusy } from "../../lib/google-calendar";
import {
  findPractice,
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { subtractRanges } from "../../lib/schedule";

/**
 * Busy time from the specialist's Google Calendar for `days` local days from
 * `from`, for the practice calendar — staff only. Time covered by bookings
 * is cut out: their own Google events would only duplicate them. Empty when
 * no calendar is linked or Google doesn't answer.
 *
 * @example client.googleCalendar.busy({ practiceId, from: "2026-11-02", days: 7 })
 */
export const busy = practiceProcedure
  .input(
    z.object({
      practiceId: z.uuid(),
      from: z.iso.date(),
      days: z.number().int().min(1).max(62).default(7),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const [staff, practice] = await Promise.all([
      findStaffMembership(
        context.db,
        input.practiceId,
        context.session.user.id,
      ),
      findPractice(context.db, input.practiceId),
    ]);
    if (!staff || !practice) throw errors.FORBIDDEN();

    const { start, end } = localDaysRange(
      input.from,
      input.days,
      practice.timezone,
    );
    const [external, booked] = await Promise.all([
      googleBusy(context.db, practice.id, start, end),
      context.db
        .select({ startsAt: Booking.startsAt, endsAt: Booking.endsAt })
        .from(Booking)
        .where(activeBookingOverlaps(practice.id, start, end)),
    ]);
    return subtractRanges(external, booked);
  });

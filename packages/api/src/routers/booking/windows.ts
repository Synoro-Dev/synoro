import { Booking } from "@synoro/db";
import { z } from "zod";

import {
  activeBookingOverlaps,
  loadRules,
  localDaysRange,
} from "../../lib/bookings";
import { googleBusy } from "../../lib/google-calendar";
import {
  findPractice,
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { freeWindows } from "../../lib/schedule";
import { resolveService } from "../../lib/services";

/**
 * Free time of `days` local days from `from` (YYYY-MM-DD, practice time
 * zone) — staff only, for booking a client who calls. Per day: working hours,
 * continuous free windows («10:00–13:00») and the bookable starts of a paid
 * service (`serviceId`, an hour by default) and of a free intro. Bookings, blocks, unpaid holds still held, busy
 * time in Google Calendar and the past are taken out.
 *
 * Unlike `slots`, free intros are listed even when visitors may not book them
 * themselves (`freeBookingEnabled`): staff always can.
 *
 * @example client.booking.windows({ practiceId, from: "2026-11-02", days: 7 })
 */
export const windows = practiceProcedure
  .errors({
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      from: z.iso.date(),
      days: z.number().int().min(1).max(31).default(7),
      /** The paid service the starts are for; the first one when missing. */
      serviceId: z.uuid().optional(),
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
    const service = await resolveService(
      context.db,
      practice.id,
      input.serviceId,
    );
    if (!service) throw errors.SERVICE_NOT_FOUND();

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
        .where(activeBookingOverlaps(practice.id, start, end)),
      googleBusy(context.db, practice.id, start, end),
    ]);

    return {
      timezone: practice.timezone,
      days: freeWindows({
        rules,
        busy: [...booked, ...external],
        from: input.from,
        days: input.days,
        timeZone: practice.timezone,
        introMinutes: practice.introMinutes,
        minutes: service.minutes,
        now: new Date(),
      }),
    };
  });

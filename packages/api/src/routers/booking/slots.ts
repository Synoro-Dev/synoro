import { Booking } from "@synoro/db";
import { z } from "zod";

import {
  activeBookingOverlaps,
  loadRules,
  localDaysRange,
} from "../../lib/bookings";
import { googleBusy } from "../../lib/google-calendar";
import { findPractice } from "../../lib/practice-access";
import { computeSlots } from "../../lib/schedule";
import { publicProcedure } from "../../orpc";

/**
 * Free slots for `days` local days from `from` (YYYY-MM-DD, practice time
 * zone): hour-long for paid consultations, half-hour for free ones. Busy
 * time (bookings, blocks, the specialist's Google Calendar) and past slots
 * are left out.
 *
 * @example client.booking.slots({ practiceId, from: "2026-11-02", days: 7 })
 */
export const slots = publicProcedure
  .errors({ NOT_FOUND: { message: "Практика не найдена" } })
  .input(
    z.object({
      practiceId: z.uuid(),
      from: z.iso.date(),
      days: z.number().int().min(1).max(33).default(7),
      kind: z.enum(["consultation", "free"]).default("consultation"),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const practice = await findPractice(context.db, input.practiceId);
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
        .where(activeBookingOverlaps(practice.id, start, end)),
      googleBusy(context.db, practice.id, start, end),
    ]);

    return {
      timezone: practice.timezone,
      slots: computeSlots({
        rules,
        busy: [...booked, ...external],
        from: input.from,
        days: input.days,
        timeZone: practice.timezone,
        kind: input.kind,
        now: new Date(),
      }),
    };
  });

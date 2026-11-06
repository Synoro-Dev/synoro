import { Booking } from "@synoro/db";
import { z } from "zod";

import {
  activeBookingOverlaps,
  loadRules,
  localDaysRange,
} from "../../lib/bookings";
import { googleBusy } from "../../lib/google-calendar";
import { findOpenPractice } from "../../lib/practice-access";
import { computeSlots } from "../../lib/schedule";
import { resolveService } from "../../lib/services";
import { publicProcedure } from "../../orpc";

/**
 * Free slots for `days` local days from `from` (YYYY-MM-DD, practice time
 * zone): paid slots as long as the service (`serviceId`, the practice's first
 * one when missing; an hour on the hour by default), free intros of the
 * practice's `introMinutes` on the half hour. Busy
 * time (bookings, blocks, the specialist's Google Calendar) and past slots
 * are left out.
 *
 * @example client.booking.slots({ practiceId, from: "2026-11-02", days: 7 })
 */
export const slots = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика не найдена" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      from: z.iso.date(),
      days: z.number().int().min(1).max(35).default(7),
      kind: z.enum(["consultation", "free"]).default("consultation"),
      /** The paid service to book; not used for free intros. */
      serviceId: z.uuid().optional(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const practice = await findOpenPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    const service =
      input.kind === "consultation"
        ? await resolveService(context.db, practice.id, input.serviceId)
        : undefined;
    if (input.kind === "consultation" && !service) {
      throw errors.SERVICE_NOT_FOUND();
    }

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
        introMinutes: practice.introMinutes,
        minutes: service?.minutes,
        now: new Date(),
      }),
    };
  });

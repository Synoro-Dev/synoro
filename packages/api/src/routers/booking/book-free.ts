import { Booking, isExclusionViolation } from "@acme/db";
import { freeConsultationFormSchema } from "@acme/validators";
import { z } from "zod";

import { loadRules } from "../../lib/bookings";
import {
  findPractice,
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { isScheduledSlot, SLOT_MINUTES } from "../../lib/schedule";

/**
 * Book a free 30-minute consultation for a guest (name + contact) — staff
 * only. Uses the half-hour grid inside working hours; no credits involved.
 *
 * @example client.booking.bookFree({ practiceId, startsAt, guestName: "Иван", guestContact: "+7 900 000-00-00" })
 */
export const bookFree = practiceProcedure
  .errors({
    SLOT_UNAVAILABLE: {
      message: "Это время недоступно для записи",
    },
  })
  .input(
    freeConsultationFormSchema.extend({
      practiceId: z.uuid(),
      startsAt: z.date(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const [staff, practice] = await Promise.all([
      findStaffMembership(context.db, input.practiceId, userId),
      findPractice(context.db, input.practiceId),
    ]);
    if (!staff || !practice) throw errors.FORBIDDEN();

    const rules = await loadRules(context.db, practice.id);
    const scheduled = isScheduledSlot({
      rules,
      startsAt: input.startsAt,
      timeZone: practice.timezone,
      kind: "free",
      now: new Date(),
    });
    if (!scheduled) throw errors.SLOT_UNAVAILABLE();

    try {
      const [booking] = await context.db
        .insert(Booking)
        .values({
          practiceId: practice.id,
          kind: "free",
          startsAt: input.startsAt,
          endsAt: new Date(
            input.startsAt.getTime() + SLOT_MINUTES.free * 60_000,
          ),
          guestName: input.guestName,
          guestContact: input.guestContact || null,
          note: input.note || null,
          createdById: userId,
        })
        .returning();
      if (!booking) throw new Error("Failed to insert booking");
      return booking;
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
  });

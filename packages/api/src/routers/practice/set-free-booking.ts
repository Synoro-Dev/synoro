import { eq, Practice } from "@synoro/db";
import { introMinutesSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * The free intro's settings — owner only. `enabled`: visitors book it
 * themselves on the booking page (`booking.bookIntro`), or not; staff book
 * intros in the calendar either way. `introMinutes`: how long new intros
 * last (`INTRO_MINUTES`). Either may be left out; intros already booked stay
 * as they are.
 *
 * @example client.practice.setFreeBooking({ practiceId, enabled: true })
 * @example client.practice.setFreeBooking({ practiceId, introMinutes: 60 })
 */
export const setFreeBooking = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Бесплатную запись настраивает владелец практики" },
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      enabled: z.boolean().optional(),
      introMinutes: introMinutesSchema.optional(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const [practice] = await context.db
      .update(Practice)
      .set({
        freeBookingEnabled: input.enabled,
        introMinutes: input.introMinutes,
      })
      .where(eq(Practice.id, owner.practiceId))
      .returning({
        enabled: Practice.freeBookingEnabled,
        introMinutes: Practice.introMinutes,
      });
    if (!practice) throw errors.FORBIDDEN();
    return practice;
  });

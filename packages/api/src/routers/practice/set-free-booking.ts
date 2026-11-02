import { eq, Practice } from "@synoro/db";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Let visitors book the free intro themselves on the booking page
 * (`booking.bookIntro`), or stop it — owner only. Intros already booked stay;
 * staff book intros in the calendar either way.
 *
 * @example client.practice.setFreeBooking({ practiceId, enabled: true })
 */
export const setFreeBooking = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Бесплатную запись настраивает владелец практики" },
  })
  .input(z.object({ practiceId: z.uuid(), enabled: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    await context.db
      .update(Practice)
      .set({ freeBookingEnabled: input.enabled })
      .where(eq(Practice.id, owner.practiceId));
    return { enabled: input.enabled };
  });

import { eq, Practice } from "@synoro/db";
import { practiceContactSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Set (or clear, with an empty string) how clients reach the specialist.
 * Owner only. Clients see it on their confirmed bookings (`booking.mine`,
 * `booking.guest`), never on the public page.
 *
 * @example client.practice.setContact({ practiceId, contact: "@anna" })
 */
export const setContact = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Контакт для клиентов задаёт владелец практики" },
  })
  .input(z.object({ practiceId: z.uuid(), contact: practiceContactSchema }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    await context.db
      .update(Practice)
      .set({ clientContact: input.contact })
      .where(eq(Practice.id, owner.practiceId));
    return { contact: input.contact };
  });

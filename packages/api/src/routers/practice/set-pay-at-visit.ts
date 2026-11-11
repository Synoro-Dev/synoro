import { eq, Practice } from "@synoro/db";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Payment at the visit — owner only. On: clients book any active service
 * themselves without paying in Synoro (`booking.bookAtVisit`), staff book
 * without the balance, and the booking page offers no online payment and no
 * packages. Balances, packages and bookings already made stay as they are.
 *
 * @example client.practice.setPayAtVisit({ practiceId, enabled: true })
 */
export const setPayAtVisit = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Оплату на приёме включает владелец практики" },
  })
  .input(z.object({ practiceId: z.uuid(), enabled: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const [practice] = await context.db
      .update(Practice)
      .set({ payAtVisit: input.enabled })
      .where(eq(Practice.id, owner.practiceId))
      .returning({ enabled: Practice.payAtVisit });
    if (!practice) throw errors.FORBIDDEN();
    return practice;
  });

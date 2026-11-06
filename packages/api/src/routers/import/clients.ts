import { asc, eq, PracticeClient } from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * The cards of clients brought in from elsewhere: staff only. Those with a
 * cabinet are in `practice.members`.
 *
 * @example client.import.clients({ practiceId })
 */
export const clients = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    return context.db
      .select({
        id: PracticeClient.id,
        name: PracticeClient.name,
        phone: PracticeClient.phone,
        email: PracticeClient.email,
        note: PracticeClient.note,
        credits: PracticeClient.credits,
        createdAt: PracticeClient.createdAt,
      })
      .from(PracticeClient)
      .where(eq(PracticeClient.practiceId, input.practiceId))
      .orderBy(asc(PracticeClient.name));
  });

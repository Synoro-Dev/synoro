import { eq, Practice } from "@synoro/db";
import { canonicalTimeZone } from "@synoro/validators";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * The time zone the practice's working hours are written in — owner only.
 * The hours of the schedule keep their numbers (Monday 10:00–13:00 stays
 * that), so in absolute time they move with the zone; bookings already made
 * are instants and stay where they are.
 *
 * @example client.practice.setTimezone({ practiceId, timezone: "Asia/Novosibirsk" })
 */
export const setTimezone = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Часовой пояс меняет владелец практики" },
    INVALID_TIMEZONE: { message: "Такого часового пояса нет" },
  })
  .input(z.object({ practiceId: z.uuid(), timezone: z.string().max(64) }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();
    const timezone = canonicalTimeZone(input.timezone);
    if (!timezone) throw errors.INVALID_TIMEZONE();

    const [practice] = await context.db
      .update(Practice)
      .set({ timezone })
      .where(eq(Practice.id, owner.practiceId))
      .returning({ timezone: Practice.timezone });
    if (!practice) throw errors.FORBIDDEN();
    return practice;
  });

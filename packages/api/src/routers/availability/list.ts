import { AvailabilityRule, asc, eq } from "@synoro/db";
import { z } from "zod";

import { publicProcedure } from "../../orpc";

/**
 * Weekly working hours of a practice, by weekday and start time. Public:
 * the booking page shows them.
 *
 * @example client.availability.list({ practiceId })
 */
export const list = publicProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input }) => {
    return context.db
      .select({
        id: AvailabilityRule.id,
        weekday: AvailabilityRule.weekday,
        startMinute: AvailabilityRule.startMinute,
        endMinute: AvailabilityRule.endMinute,
      })
      .from(AvailabilityRule)
      .where(eq(AvailabilityRule.practiceId, input.practiceId))
      .orderBy(
        asc(AvailabilityRule.weekday),
        asc(AvailabilityRule.startMinute),
      );
  });

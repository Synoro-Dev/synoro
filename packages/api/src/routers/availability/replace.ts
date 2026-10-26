import { AvailabilityRule, and, eq, notInArray } from "@acme/db";
import { availabilityFormSchema } from "@acme/validators";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Replace the practice's weekly working hours with `rules` — staff only.
 * Existing bookings are kept even if they now fall outside the hours.
 *
 * New rules go in first and the old ones are deleted after, so a failure
 * midway never leaves the practice without a schedule (the Neon HTTP driver
 * has no interactive transactions).
 *
 * @example client.availability.replace({ practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 1080 }] })
 */
export const replace = practiceProcedure
  .input(availabilityFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    const inserted = input.rules.length
      ? await context.db
          .insert(AvailabilityRule)
          .values(
            input.rules.map((rule) => ({
              ...rule,
              practiceId: input.practiceId,
            })),
          )
          .returning({ id: AvailabilityRule.id })
      : [];

    const keep = inserted.map((r) => r.id);
    await context.db
      .delete(AvailabilityRule)
      .where(
        and(
          eq(AvailabilityRule.practiceId, input.practiceId),
          keep.length ? notInArray(AvailabilityRule.id, keep) : undefined,
        ),
      );

    return { count: keep.length };
  });

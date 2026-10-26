import { asc, eq, PracticeMember, sql, user } from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Everyone in a practice with their consultation balance — staff only.
 * Owner first, then administrators, then clients by name.
 *
 * @example client.practice.members({ practiceId })
 */
export const members = practiceProcedure
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
        id: PracticeMember.id,
        userId: PracticeMember.userId,
        role: PracticeMember.role,
        credits: PracticeMember.credits,
        name: user.name,
        email: user.email,
        joinedAt: PracticeMember.createdAt,
      })
      .from(PracticeMember)
      .innerJoin(user, eq(user.id, PracticeMember.userId))
      .where(eq(PracticeMember.practiceId, input.practiceId))
      .orderBy(
        sql`case ${PracticeMember.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
        asc(user.name),
      );
  });

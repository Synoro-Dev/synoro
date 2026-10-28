import { asc, eq, Practice, PracticeMember } from "@synoro/db";

import { protectedProcedure } from "../../orpc";

/**
 * Practices the caller belongs to — as owner, administrator or client —
 * with their role and credit balance.
 *
 * @example client.practice.mine()
 */
export const mine = protectedProcedure.handler(async ({ context }) => {
  return context.db
    .select({
      practiceId: Practice.id,
      name: Practice.name,
      slug: Practice.slug,
      timezone: Practice.timezone,
      profession: Practice.profession,
      memberId: PracticeMember.id,
      role: PracticeMember.role,
      credits: PracticeMember.credits,
    })
    .from(PracticeMember)
    .innerJoin(Practice, eq(Practice.id, PracticeMember.practiceId))
    .where(eq(PracticeMember.userId, context.session.user.id))
    .orderBy(asc(Practice.name));
});

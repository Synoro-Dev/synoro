import { asc, eq, Practice, PracticeDomain, PracticeMember } from "@synoro/db";

import { readyDomainOn, siteDomain } from "../../lib/domains";
import { protectedProcedure } from "../../orpc";

/**
 * Practices the caller belongs to — as owner, administrator or client —
 * with their role, credit balance and own domain once it fully works.
 *
 * @example client.practice.mine()
 */
export const mine = protectedProcedure.handler(async ({ context }) => {
  const rows = await context.db
    .select({
      practiceId: Practice.id,
      name: Practice.name,
      slug: Practice.slug,
      timezone: Practice.timezone,
      profession: Practice.profession,
      memberId: PracticeMember.id,
      role: PracticeMember.role,
      credits: PracticeMember.credits,
      domain: PracticeDomain.hostname,
    })
    .from(PracticeMember)
    .innerJoin(Practice, eq(Practice.id, PracticeMember.practiceId))
    .leftJoin(PracticeDomain, readyDomainOn(Practice.id))
    .where(eq(PracticeMember.userId, context.session.user.id))
    .orderBy(asc(Practice.name));
  return rows.map(({ domain, ...row }) => ({
    ...row,
    siteDomain: siteDomain(domain),
  }));
});

import { and, asc, eq, gt, Practice, PracticeInvitation, sql } from "@synoro/db";

import { invitationRecipient } from "../../lib/invitation-recipient";
import { protectedProcedure } from "../../orpc";

/**
 * Pending invitations for the caller's verified email, including ones sent before signup.
 *
 * @example client.practice.invitations()
 */
export const invitations = protectedProcedure.handler(async ({ context }) => {
  const email = await invitationRecipient(context.db, context.session.user.id);
  if (!email) return { emailVerified: false, invitations: [] };

  const pending = await context.db
    .select({
      id: PracticeInvitation.id,
      practiceName: Practice.name,
      role: PracticeInvitation.role,
    })
    .from(PracticeInvitation)
    .innerJoin(Practice, eq(Practice.id, PracticeInvitation.practiceId))
    .where(
      and(
        eq(PracticeInvitation.email, email),
        gt(PracticeInvitation.expiresAt, sql`now()`),
      ),
    )
    .orderBy(asc(PracticeInvitation.createdAt));
  return { emailVerified: true, invitations: pending };
});

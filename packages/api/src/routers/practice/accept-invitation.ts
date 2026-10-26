import { and, eq, gt, PracticeInvitation, PracticeMember, sql } from "@synoro/db";
import { z } from "zod";

import { invitationRecipient } from "../../lib/invitation-recipient";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Accept only an invitation addressed to the caller's current verified email.
 * Consuming it and creating/promoting membership are one transaction.
 * Existing credits and owner/admin roles are preserved.
 *
 * @example client.practice.acceptInvitation({ invitationId })
 */
export const acceptInvitation = practiceProcedure
  .errors({ NOT_FOUND: { message: "Приглашение не найдено или истекло" } })
  .input(z.object({ invitationId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const email = await invitationRecipient(
      context.db,
      context.session.user.id,
    );
    if (!email)
      throw errors.FORBIDDEN({
        message:
          "Для принятия приглашения войдите по одноразовому коду из почты",
      });

    return context.db.transaction(async (tx) => {
      const [invitation] = await tx
        .delete(PracticeInvitation)
        .where(
          and(
            eq(PracticeInvitation.id, input.invitationId),
            eq(PracticeInvitation.email, email),
            gt(PracticeInvitation.expiresAt, sql`now()`),
          ),
        )
        .returning();
      if (!invitation) throw errors.NOT_FOUND();

      const inviter = await findStaffMembership(
        tx,
        invitation.practiceId,
        invitation.invitedById,
      );
      if (
        !inviter ||
        (invitation.role === "admin" && inviter.role !== "owner")
      ) {
        throw errors.FORBIDDEN();
      }

      const [member] = await tx
        .insert(PracticeMember)
        .values({
          practiceId: invitation.practiceId,
          userId: context.session.user.id,
          role: invitation.role,
        })
        .onConflictDoUpdate({
          target: [PracticeMember.practiceId, PracticeMember.userId],
          set: {
            role: sql`case when ${PracticeMember.role} = 'client' then ${invitation.role}::practice_member_role else ${PracticeMember.role} end`,
          },
        })
        .returning({
          id: PracticeMember.id,
          role: PracticeMember.role,
          credits: PracticeMember.credits,
        });
      if (!member) throw new Error("Failed to accept invitation");
      return member;
    });
  });

import { PracticeInvitation, sql } from "@synoro/db";
import { memberInviteFormSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Invite by email without looking up or disclosing the recipient's account.
 * Membership (including promotion to administrator) requires acceptance.
 * Only the owner may invite administrators.
 *
 * @example client.practice.addMember({ practiceId, email, role: "client" })
 */
export const addMember = practiceProcedure
  .input(memberInviteFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();
    if (input.role === "admin" && staff.role !== "owner") {
      throw errors.FORBIDDEN({
        message: "Назначать администраторов может только владелец",
      });
    }

    await context.db
      .insert(PracticeInvitation)
      .values({
        practiceId: input.practiceId,
        email: input.email.toLowerCase(),
        role: input.role,
        invitedById: context.session.user.id,
      })
      .onConflictDoUpdate({
        target: [
          PracticeInvitation.practiceId,
          PracticeInvitation.email,
          PracticeInvitation.role,
        ],
        set: {
          invitedById: context.session.user.id,
          expiresAt: sql`now() + interval '7 days'`,
        },
      });

    return { invited: true };
  });

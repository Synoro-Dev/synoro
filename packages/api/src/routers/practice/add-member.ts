import { logger } from "@synoro/config";
import { eq, Practice, PracticeInvitation, sql } from "@synoro/db";
import { dispatchEmail } from "@synoro/jobs";
import { memberInviteFormSchema } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { practicesUrl } from "../../lib/urls";

/**
 * Invite by email without looking up or disclosing the recipient's account;
 * the address gets a mail with the way to accept. A mail failure keeps the
 * invitation (it is shown under «Практики» after signing in) and is reported
 * as `emailed: false`. Membership (including promotion to administrator) requires acceptance.
 * Only the owner may invite administrators, and only on «Про».
 *
 * @example client.practice.addMember({ practiceId, email, role: "client" })
 */
export const addMember = practiceProcedure
  .errors({
    PLAN_REQUIRED: {
      message: "Доступно на тарифе «Про» — оплатите его в настройках",
    },
  })
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
    if (input.role === "admin" && !(await hasPro(context.db, staff.userId))) {
      throw errors.PLAN_REQUIRED({
        message: "Администраторы доступны на тарифе «Про»",
      });
    }

    const email = input.email.toLowerCase();
    await context.db
      .insert(PracticeInvitation)
      .values({
        practiceId: input.practiceId,
        email,
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

    const practice = await context.db.query.Practice.findFirst({
      columns: { name: true },
      where: eq(Practice.id, input.practiceId),
    });
    try {
      await dispatchEmail({
        template: "practice-invitation",
        to: [email],
        subject: `Приглашение в практику «${practice?.name ?? "Synoro"}»`,
        props: {
          practiceName: practice?.name ?? "Synoro",
          inviterName: context.session.user.name,
          role: input.role,
          acceptUrl: practicesUrl(),
        },
      });
    } catch (error) {
      logger.warn("practice.invitation_email_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { invited: true, emailed: false };
    }

    return { invited: true, emailed: true };
  });

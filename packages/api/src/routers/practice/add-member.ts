import { logger } from "@synoro/config";
import { eq, Practice, PracticeInvitation, sql } from "@synoro/db";
import { sendOrQueueEmail } from "@synoro/jobs";
import { memberInviteFormSchema } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  claimInviteMail,
  inviteMailsExhausted,
} from "../../lib/invitation-mail";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { practicesUrl } from "../../lib/urls";

/**
 * Invite by email without looking up or disclosing the recipient's account;
 * the address gets a mail with the way to accept. `mail` says what happened
 * to it: `sent`, `queued` (a worker sends it, and may still fail), `failed`
 * (not sent — the invitation stays and shows under «Практики» after signing
 * in, so the inviter should tell the recipient) or `recent` (the same
 * invitation was mailed within the hour). One account causes at most
 * `MAX_INVITE_MAILS_PER_DAY` mails a day.
 * Membership (including promotion to administrator) requires acceptance.
 * Only the owner may invite administrators, and only on «Про».
 *
 * @example client.practice.addMember({ practiceId, email, role: "client" })
 */
export const addMember = practiceProcedure
  .errors({
    PLAN_REQUIRED: {
      message: "Доступно на тарифе «Про» — оплатите его в настройках",
    },
    TOO_MANY_INVITES: {
      message: "Слишком много приглашений за сутки — попробуйте завтра",
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

    if (await inviteMailsExhausted(context.db, staff.userId)) {
      throw errors.TOO_MANY_INVITES();
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

    // The invitation is saved by now, so nothing below may fail the request:
    // a mail problem is reported as `mail: "failed"`. Inside the cooldown the
    // invitation is extended, but no second mail goes.
    let mailRight: Awaited<ReturnType<typeof claimInviteMail>> | undefined;
    const giveBack = () =>
      mailRight?.release().catch(() => {
        logger.warn("practice.invitation_release_failed", {
          practiceId: input.practiceId,
        });
      });
    try {
      mailRight = await claimInviteMail(context.db, {
        userId: context.session.user.id,
        practiceId: input.practiceId,
        role: input.role,
        email,
      });
      if (!mailRight.claimed) return { invited: true, mail: "recent" as const };

      const practice = await context.db.query.Practice.findFirst({
        columns: { name: true },
        where: eq(Practice.id, input.practiceId),
      });
      const outcome = await sendOrQueueEmail({
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
      if (outcome === "skipped") {
        await giveBack();
        return { invited: true, mail: "failed" as const };
      }
      return { invited: true, mail: outcome };
    } catch {
      // The provider's error text may repeat the recipient's address.
      logger.warn("practice.invitation_email_failed", {
        practiceId: input.practiceId,
      });
      await giveBack();
      return { invited: true, mail: "failed" as const };
    }
  });

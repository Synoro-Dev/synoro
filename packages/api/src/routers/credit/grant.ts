import { and, eq, PracticeMember } from "@synoro/db";
import { creditGrantFormSchema } from "@synoro/validators";
import { z } from "zod";

import { adjustCredits, recordCredit } from "../../lib/bookings";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Record paid consultations for a client (`delta` > 0) or correct the
 * balance (`delta` < 0) — staff only. The balance never goes below zero.
 *
 * @example client.credit.grant({ practiceId, memberId, delta: 5, note: "Пакет из 5" })
 */
export const grant = practiceProcedure
  .errors({
    NOT_FOUND: { message: "Клиент не найден" },
    NEGATIVE_BALANCE: {
      message: "Нельзя списать больше консультаций, чем есть на балансе",
    },
  })
  .input(
    creditGrantFormSchema.extend({
      practiceId: z.uuid(),
      memberId: z.uuid(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      userId,
    );
    if (!staff) throw errors.FORBIDDEN();

    const member = await context.db.query.PracticeMember.findFirst({
      where: and(
        eq(PracticeMember.id, input.memberId),
        eq(PracticeMember.practiceId, input.practiceId),
      ),
    });
    if (!member) throw errors.NOT_FOUND();

    const credits = await adjustCredits(context.db, member.id, input.delta);
    if (credits === undefined) throw errors.NEGATIVE_BALANCE();

    await recordCredit(context.db, {
      memberId: member.id,
      delta: input.delta,
      reason: input.delta > 0 ? "purchase" : "adjustment",
      note: input.note || null,
      createdById: userId,
    });

    return { memberId: member.id, credits };
  });

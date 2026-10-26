import { CreditEntry, desc, eq, PracticeMember } from "@acme/db";
import { z } from "zod";

import { findStaffMembership } from "../../lib/practice-access";
import { protectedProcedure } from "../../orpc";

/**
 * Last 100 balance changes of a member, newest first — visible to the
 * member themselves and to the practice's staff.
 *
 * @example client.credit.history({ memberId })
 */
export const history = protectedProcedure
  .errors({ NOT_FOUND: { message: "Клиент не найден" } })
  .input(z.object({ memberId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const member = await context.db.query.PracticeMember.findFirst({
      where: eq(PracticeMember.id, input.memberId),
    });
    const allowed =
      member &&
      (member.userId === userId ||
        (await findStaffMembership(context.db, member.practiceId, userId)));
    if (!allowed) throw errors.NOT_FOUND();

    return context.db
      .select({
        id: CreditEntry.id,
        delta: CreditEntry.delta,
        reason: CreditEntry.reason,
        note: CreditEntry.note,
        bookingId: CreditEntry.bookingId,
        createdAt: CreditEntry.createdAt,
      })
      .from(CreditEntry)
      .where(eq(CreditEntry.memberId, input.memberId))
      .orderBy(desc(CreditEntry.createdAt))
      .limit(100);
  });

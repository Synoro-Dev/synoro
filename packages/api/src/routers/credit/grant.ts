import { and, eq, OfflinePayment, PracticeMember } from "@synoro/db";
import {
  creditGrantFormSchema,
  offlinePaymentFormSchema,
} from "@synoro/validators";
import { z } from "zod";

import { adjustCredits, recordCredit } from "../../lib/bookings";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Record paid consultations for a client (`delta` > 0) or correct the
 * balance (`delta` < 0) — staff only. The balance never goes below zero.
 * With `payment` (a grant only) the money the client paid outside Synoro is
 * recorded too (`offline_payments`, linked to the balance entry), so a
 * package credited by hand has an amount. All or nothing.
 *
 * @example client.credit.grant({ practiceId, memberId, delta: 5, note: "Пакет из 5" })
 * @example client.credit.grant({ practiceId, memberId, delta: 5, payment: { amount: 1_400_000, method: "transfer", paidAt: new Date() } })
 */
export const grant = practiceProcedure
  .errors({
    NOT_FOUND: { message: "Клиент не найден" },
    NEGATIVE_BALANCE: {
      message: "Нельзя списать больше, чем есть на балансе",
    },
    PAYMENT_WITHOUT_GRANT: {
      message: "Оплату можно указать только при начислении",
    },
  })
  .input(
    creditGrantFormSchema.extend({
      practiceId: z.uuid(),
      memberId: z.uuid(),
      /** What the client paid for it outside Synoro. */
      payment: offlinePaymentFormSchema.optional(),
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
    const { payment } = input;
    if (payment && input.delta <= 0) throw errors.PAYMENT_WITHOUT_GRANT();

    const credits = await context.db.transaction(async (tx) => {
      const credits = await adjustCredits(tx, member.id, input.delta);
      if (credits === undefined) return undefined;
      const entryId = await recordCredit(tx, {
        memberId: member.id,
        delta: input.delta,
        reason: input.delta > 0 ? "purchase" : "adjustment",
        note: input.note || null,
        createdById: userId,
      });
      if (payment) {
        await tx.insert(OfflinePayment).values({
          practiceId: input.practiceId,
          memberId: member.id,
          creditEntryId: entryId,
          amount: payment.amount,
          method: payment.method,
          paidAt: payment.paidAt,
          note: payment.note || input.note || null,
          createdById: userId,
        });
      }
      return credits;
    });
    if (credits === undefined) throw errors.NEGATIVE_BALANCE();

    return { memberId: member.id, credits };
  });

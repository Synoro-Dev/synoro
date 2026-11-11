import { and, Booking, eq, OfflinePayment, PracticeMember } from "@synoro/db";
import { offlinePaymentFormSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Write down money a client paid outside Synoro — staff only. For a booking
 * paid at the visit pass `bookingId` (the client is the booking's; it then
 * leaves «Ждут оплаты»), for anything else `memberId`. A booking is paid
 * once (ALREADY_PAID), and only one that took nothing from the balance — one
 * paid with credits was paid already (PREPAID). Nothing on the balance
 * changes: a package paid this way goes through `credit.grant` with `payment`.
 *
 * @example client.offlinePayment.record({ practiceId, bookingId, amount: 300_000, method: "cash", paidAt: new Date() })
 */
export const record = practiceProcedure
  .errors({
    NOT_FOUND: { message: "Не нашли клиента или запись" },
    ALREADY_PAID: { message: "Эта запись уже отмечена оплаченной" },
    PREPAID: { message: "Эта запись оплачена с баланса клиента" },
  })
  .input(
    offlinePaymentFormSchema
      .extend({
        practiceId: z.uuid(),
        bookingId: z.uuid().optional(),
        memberId: z.uuid().optional(),
      })
      .refine((input) => input.bookingId || input.memberId, {
        message: "Укажите клиента или запись",
      }),
  )
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    const userId = context.session.user.id;
    if (!(await findStaffMembership(db, input.practiceId, userId))) {
      throw errors.FORBIDDEN();
    }

    let memberId = input.memberId ?? null;
    if (input.bookingId) {
      const booking = await db.query.Booking.findFirst({
        where: and(
          eq(Booking.id, input.bookingId),
          eq(Booking.practiceId, input.practiceId),
        ),
        columns: { kind: true, memberId: true, credits: true },
      });
      if (!booking || booking.kind === "blocked") throw errors.NOT_FOUND();
      if (booking.credits > 0) throw errors.PREPAID();
      memberId = booking.memberId;
    } else if (memberId) {
      const member = await db.query.PracticeMember.findFirst({
        where: and(
          eq(PracticeMember.id, memberId),
          eq(PracticeMember.practiceId, input.practiceId),
        ),
        columns: { id: true },
      });
      if (!member) throw errors.NOT_FOUND();
    }

    const row = await db.transaction(async (tx) => {
      if (input.bookingId) {
        // One payment per booking, even for two quick taps.
        await tx
          .select({ id: Booking.id })
          .from(Booking)
          .where(eq(Booking.id, input.bookingId))
          .for("update");
        const paid = await tx.query.OfflinePayment.findFirst({
          where: eq(OfflinePayment.bookingId, input.bookingId),
          columns: { id: true },
        });
        if (paid) return undefined;
      }
      const [inserted] = await tx
        .insert(OfflinePayment)
        .values({
          practiceId: input.practiceId,
          memberId,
          bookingId: input.bookingId ?? null,
          amount: input.amount,
          method: input.method,
          paidAt: input.paidAt,
          note: input.note || null,
          createdById: userId,
        })
        .returning({ id: OfflinePayment.id });
      return inserted;
    });
    if (!row) throw errors.ALREADY_PAID();
    return { id: row.id };
  });

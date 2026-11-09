import { and, eq, OfflinePayment } from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Delete a payment written down by mistake — staff only. Only the record of
 * money goes: credits granted with it stay on the balance (correct them in
 * the client's card), and a booking it paid is back in «Ждут оплаты».
 *
 * @example client.offlinePayment.remove({ practiceId, paymentId })
 */
export const remove = practiceProcedure
  .errors({ NOT_FOUND: { message: "Оплата не найдена" } })
  .input(z.object({ practiceId: z.uuid(), paymentId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    const removed = await context.db
      .delete(OfflinePayment)
      .where(
        and(
          eq(OfflinePayment.id, input.paymentId),
          eq(OfflinePayment.practiceId, input.practiceId),
        ),
      )
      .returning({ id: OfflinePayment.id });
    if (removed.length === 0) throw errors.NOT_FOUND();
    return { id: input.paymentId };
  });

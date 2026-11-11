import { eq, Payment, Practice, PracticeMember } from "@synoro/db";
import { z } from "zod";

import { syncPayment } from "../../lib/payments";
import { findStaffMembership } from "../../lib/practice-access";
import { protectedProcedure } from "../../orpc";

/**
 * A payment's status for the client who made it (or the practice's staff).
 * A pending one is checked with the provider first, so the cabinet shows
 * the result right after the redirect back, webhook or not.
 *
 * @example client.payment.status({ paymentId })
 */
export const status = protectedProcedure
  .errors({ NOT_FOUND: { message: "Платёж не найден" } })
  .input(z.object({ paymentId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const found = await context.db.query.Payment.findFirst({
      where: eq(Payment.id, input.paymentId),
    });
    const allowed =
      found &&
      (found.createdById === userId ||
        (await findStaffMembership(context.db, found.practiceId, userId)));
    if (!found || !allowed) throw errors.NOT_FOUND();

    const payment = await syncPayment(context.db, found);
    const [practice, member] = await Promise.all([
      context.db.query.Practice.findFirst({
        where: eq(Practice.id, payment.practiceId),
        columns: { name: true, slug: true, profession: true },
      }),
      payment.memberId
        ? context.db.query.PracticeMember.findFirst({
            where: eq(PracticeMember.id, payment.memberId),
            columns: { credits: true },
          })
        : undefined,
    ]);

    return {
      id: payment.id,
      status: payment.status,
      credits: payment.credits,
      amount: payment.amount,
      confirmationUrl: payment.confirmationUrl,
      practiceId: payment.practiceId,
      practiceName: practice?.name ?? "",
      practiceSlug: practice?.slug ?? "",
      profession: practice?.profession ?? "other",
      balance: member?.credits ?? null,
    };
  });

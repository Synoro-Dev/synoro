import { desc, eq, Payment, Practice } from "@synoro/db";

import { PROVIDER_NAMES } from "../../lib/payments";
import { protectedProcedure } from "../../orpc";

/** Provider payment pages expire; past this a pending payment isn't resumable. */
const RESUMABLE_MS = 60 * 60 * 1000;

/**
 * The caller's last 50 payments in every practice, newest first. `resumeUrl`
 * leads back to the payment page of a recent unfinished one.
 *
 * @example client.payment.mine()
 */
export const mine = protectedProcedure.handler(async ({ context }) => {
  const rows = await context.db
    .select({
      id: Payment.id,
      status: Payment.status,
      credits: Payment.credits,
      amount: Payment.amount,
      provider: Payment.provider,
      confirmationUrl: Payment.confirmationUrl,
      createdAt: Payment.createdAt,
      paidAt: Payment.paidAt,
      practiceId: Practice.id,
      practiceName: Practice.name,
    })
    .from(Payment)
    .innerJoin(Practice, eq(Practice.id, Payment.practiceId))
    .where(eq(Payment.createdById, context.session.user.id))
    .orderBy(desc(Payment.createdAt))
    .limit(50);

  const now = Date.now();
  return rows.map(({ confirmationUrl, ...row }) => ({
    ...row,
    providerName: PROVIDER_NAMES[row.provider],
    resumeUrl:
      row.status === "pending" && now - row.createdAt.getTime() < RESUMABLE_MS
        ? confirmationUrl
        : null,
  }));
});

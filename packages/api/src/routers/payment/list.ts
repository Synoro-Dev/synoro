import {
  and,
  desc,
  eq,
  gte,
  Payment,
  PracticeMember,
  sql,
  user,
} from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The practice's last 100 online payments with the client, plus what came
 * in over the last 30 days — staff only.
 *
 * @example client.payment.list({ practiceId })
 */
export const list = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    const [payments, [totals]] = await Promise.all([
      context.db
        .select({
          id: Payment.id,
          status: Payment.status,
          credits: Payment.credits,
          amount: Payment.amount,
          provider: Payment.provider,
          createdAt: Payment.createdAt,
          paidAt: Payment.paidAt,
          clientName: user.name,
          clientEmail: user.email,
        })
        .from(Payment)
        .leftJoin(PracticeMember, eq(PracticeMember.id, Payment.memberId))
        .leftJoin(user, eq(user.id, PracticeMember.userId))
        .where(eq(Payment.practiceId, input.practiceId))
        .orderBy(desc(Payment.createdAt))
        .limit(100),
      context.db
        .select({
          amount: sql<number>`coalesce(sum(${Payment.amount}), 0)::int`,
          credits: sql<number>`coalesce(sum(${Payment.credits}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(Payment)
        .where(
          and(
            eq(Payment.practiceId, input.practiceId),
            eq(Payment.status, "succeeded"),
            gte(Payment.paidAt, new Date(Date.now() - MONTH_MS)),
          ),
        ),
    ]);

    return {
      payments,
      month: totals ?? { amount: 0, credits: 0, count: 0 },
    };
  });

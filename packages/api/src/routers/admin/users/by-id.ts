import {
  desc,
  eq,
  Practice,
  PracticeMember,
  SubscriptionPayment,
  user,
} from "@synoro/db";
import { z } from "zod";

import {
  findActiveAutorenewal,
  findSubscription,
  planOf,
} from "../../../lib/billing";
import { adminProcedure } from "../../../orpc";

/**
 * One user's card: profile, the practices they belong to (and in what
 * role), their «Про» plan with auto-renewal, and the last «Про» payments.
 *
 * Throws NOT_FOUND when no user matches the given id.
 */
export const byId = adminProcedure
  .errors({ NOT_FOUND: { message: "Пользователь не найден" } })
  .input(z.object({ id: z.string().min(1) }))
  .handler(async ({ context, input, errors }) => {
    const found = await context.db.query.user.findFirst({
      where: eq(user.id, input.id),
      columns: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        phone: true,
        role: true,
        banned: true,
        banReason: true,
        banExpires: true,
        createdAt: true,
      },
    });

    if (!found) {
      throw errors.NOT_FOUND();
    }

    const [practices, subscription, autorenewal, payments] = await Promise.all([
      context.db
        .select({
          id: Practice.id,
          name: Practice.name,
          slug: Practice.slug,
          role: PracticeMember.role,
          joinedAt: PracticeMember.createdAt,
        })
        .from(PracticeMember)
        .innerJoin(Practice, eq(Practice.id, PracticeMember.practiceId))
        .where(eq(PracticeMember.userId, found.id))
        .orderBy(desc(PracticeMember.createdAt)),
      findSubscription(context.db, found.id),
      findActiveAutorenewal(context.db, found.id),
      context.db
        .select({
          id: SubscriptionPayment.id,
          number: SubscriptionPayment.number,
          period: SubscriptionPayment.period,
          amount: SubscriptionPayment.amount,
          status: SubscriptionPayment.status,
          paidAt: SubscriptionPayment.paidAt,
          refundedAt: SubscriptionPayment.refundedAt,
          createdAt: SubscriptionPayment.createdAt,
        })
        .from(SubscriptionPayment)
        .where(eq(SubscriptionPayment.userId, found.id))
        .orderBy(desc(SubscriptionPayment.createdAt))
        .limit(20),
    ]);

    return {
      user: found,
      practices,
      plan: {
        ...planOf(subscription),
        autorenew: autorenewal ? autorenewal.period : null,
      },
      payments,
    };
  });

import {
  and,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  paymentStatus,
  type SQL,
  SubscriptionPayment,
  sql,
  user,
} from "@synoro/db";
import { z } from "zod";

import { adminProcedure } from "../../../orpc";
import { containsPattern } from "../contains";
import { pageInput } from "../page-input";

/**
 * «Про» payments to Synoro, newest first, with who paid. `status` narrows
 * to one bank status, or `refunded`; `query` matches the payer's name or
 * email anywhere, or the order number exactly.
 *
 * @example client.admin.payments.list({ status: "succeeded" })
 */
export const list = adminProcedure
  .input(
    pageInput.extend({
      status: z.enum([...paymentStatus.enumValues, "refunded"]).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const filters: (SQL | undefined)[] = [];
    if (input.status === "refunded") {
      filters.push(isNotNull(SubscriptionPayment.refundedAt));
    } else if (input.status) {
      filters.push(
        eq(SubscriptionPayment.status, input.status),
        isNull(SubscriptionPayment.refundedAt),
      );
    }
    if (input.query) {
      const pattern = containsPattern(input.query);
      const number = /^\d{1,9}$/.test(input.query)
        ? eq(SubscriptionPayment.number, Number(input.query))
        : undefined;
      filters.push(
        or(ilike(user.name, pattern), ilike(user.email, pattern), number),
      );
    }
    const where = and(...filters);

    const rows = await context.db
      .select({
        id: SubscriptionPayment.id,
        number: SubscriptionPayment.number,
        period: SubscriptionPayment.period,
        amount: SubscriptionPayment.amount,
        status: SubscriptionPayment.status,
        paidAt: SubscriptionPayment.paidAt,
        refundedAt: SubscriptionPayment.refundedAt,
        /** Charged by auto-renewal rather than paid by hand. */
        automatic: sql<boolean>`${SubscriptionPayment.chargedFor} is not null`,
        createdAt: SubscriptionPayment.createdAt,
        user: { id: user.id, name: user.name, email: user.email },
      })
      .from(SubscriptionPayment)
      .innerJoin(user, eq(user.id, SubscriptionPayment.userId))
      .where(where)
      .orderBy(
        desc(SubscriptionPayment.createdAt),
        desc(SubscriptionPayment.id),
      )
      .limit(input.limit)
      .offset(input.offset);

    const [total] = await context.db
      .select({ value: count() })
      .from(SubscriptionPayment)
      .innerJoin(user, eq(user.id, SubscriptionPayment.userId))
      .where(where);

    return { items: rows, total: total?.value ?? 0 };
  });

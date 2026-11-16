import {
  and,
  count,
  desc,
  eq,
  ilike,
  or,
  Practice,
  paymentStatus,
  SlugOrder,
  type SQL,
  user,
} from "@synoro/db";
import { z } from "zod";

import { adminProcedure } from "../../../orpc";
import { containsPattern } from "../contains";
import { pageInput } from "../page-input";

/**
 * Premium address orders (`synoro.ru/max`), newest first — money to Synoro
 * outside «Про». `query` matches the address, the order number exactly, the
 * buyer's name or email, or the practice's name; `status` narrows to one
 * bank status. The buyer and the practice can be gone (deletion sets the
 * foreign keys null) — their cells then read «—».
 *
 * @example client.admin.slugOrders.list({ status: "pending" })
 */
export const list = adminProcedure
  .input(
    pageInput.extend({
      status: z.enum(paymentStatus.enumValues).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const filters: (SQL | undefined)[] = [];
    if (input.status) filters.push(eq(SlugOrder.status, input.status));
    if (input.query) {
      const pattern = containsPattern(input.query);
      const number = /^\d{1,9}$/.test(input.query)
        ? eq(SlugOrder.number, Number(input.query))
        : undefined;
      filters.push(
        or(
          ilike(SlugOrder.slug, pattern),
          ilike(user.name, pattern),
          ilike(user.email, pattern),
          ilike(Practice.name, pattern),
          number,
        ),
      );
    }
    const where = and(...filters);

    const rows = await context.db
      .select({
        id: SlugOrder.id,
        number: SlugOrder.number,
        slug: SlugOrder.slug,
        amount: SlugOrder.amount,
        status: SlugOrder.status,
        holdUntil: SlugOrder.holdUntil,
        paidAt: SlugOrder.paidAt,
        createdAt: SlugOrder.createdAt,
        user: { id: user.id, name: user.name, email: user.email },
        practice: { id: Practice.id, name: Practice.name, slug: Practice.slug },
      })
      .from(SlugOrder)
      .leftJoin(user, eq(user.id, SlugOrder.userId))
      .leftJoin(Practice, eq(Practice.id, SlugOrder.practiceId))
      .where(where)
      .orderBy(desc(SlugOrder.createdAt), desc(SlugOrder.id))
      .limit(input.limit)
      .offset(input.offset);

    const [total] = await context.db
      .select({ value: count() })
      .from(SlugOrder)
      .leftJoin(user, eq(user.id, SlugOrder.userId))
      .leftJoin(Practice, eq(Practice.id, SlugOrder.practiceId))
      .where(where);

    return { items: rows, total: total?.value ?? 0 };
  });

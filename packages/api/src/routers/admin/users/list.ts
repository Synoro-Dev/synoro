import {
  count,
  desc,
  eq,
  ilike,
  or,
  Practice,
  type SQL,
  Subscription,
  sql,
  user,
} from "@synoro/db";

import { planOf } from "../../../lib/billing";
import { adminProcedure } from "../../../orpc";
import { containsPattern } from "../contains";
import { pageInput } from "../page-input";

/**
 * Registered users, newest first, with their «Про» plan and how many
 * practices they own. `query` matches name, email or phone anywhere.
 *
 * @example client.admin.users.list({ query: "anna", limit: 50, offset: 0 })
 */
export const list = adminProcedure
  .input(pageInput)
  .handler(async ({ context, input }) => {
    let where: SQL | undefined;
    if (input.query) {
      const pattern = containsPattern(input.query);
      where = or(
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(user.phone, pattern),
      );
    }

    const rows = await context.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        banned: user.banned,
        createdAt: user.createdAt,
        subscription: Subscription,
        practices: sql<number>`(select count(*)::int from ${Practice} where ${Practice.ownerId} = ${user.id})`,
      })
      .from(user)
      .leftJoin(Subscription, eq(Subscription.userId, user.id))
      .where(where)
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(input.limit)
      .offset(input.offset);

    const [total] = await context.db
      .select({ value: count() })
      .from(user)
      .where(where);

    return {
      items: rows.map(({ subscription, ...row }) => ({
        ...row,
        plan: planOf(subscription ?? undefined).status,
      })),
      total: total?.value ?? 0,
    };
  });

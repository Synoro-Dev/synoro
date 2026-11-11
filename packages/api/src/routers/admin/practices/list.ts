import {
  Booking,
  count,
  desc,
  eq,
  ilike,
  or,
  Practice,
  PracticeMember,
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
 * Every practice, newest first: its owner and the owner's «Про» plan,
 * clients, and bookings made in the last 30 days. `query` matches the
 * practice's name or slug and the owner's email anywhere.
 *
 * @example client.admin.practices.list({ query: "anna" })
 */
export const list = adminProcedure
  .input(pageInput)
  .handler(async ({ context, input }) => {
    let where: SQL | undefined;
    if (input.query) {
      const pattern = containsPattern(input.query);
      where = or(
        ilike(Practice.name, pattern),
        ilike(Practice.slug, pattern),
        ilike(user.email, pattern),
      );
    }

    const rows = await context.db
      .select({
        id: Practice.id,
        name: Practice.name,
        slug: Practice.slug,
        profession: Practice.profession,
        createdAt: Practice.createdAt,
        owner: { id: user.id, name: user.name, email: user.email },
        subscription: Subscription,
        clients: sql<number>`(select count(*)::int from ${PracticeMember} where ${PracticeMember.practiceId} = ${Practice.id} and ${PracticeMember.role} = 'client')`,
        bookings: sql<number>`(select count(*)::int from ${Booking} where ${Booking.practiceId} = ${Practice.id} and ${Booking.createdAt} > now() - interval '30 days')`,
      })
      .from(Practice)
      .innerJoin(user, eq(user.id, Practice.ownerId))
      .leftJoin(Subscription, eq(Subscription.userId, Practice.ownerId))
      .where(where)
      .orderBy(desc(Practice.createdAt), desc(Practice.id))
      .limit(input.limit)
      .offset(input.offset);

    const [total] = await context.db
      .select({ value: count() })
      .from(Practice)
      .innerJoin(user, eq(user.id, Practice.ownerId))
      .where(where);

    return {
      items: rows.map(({ subscription, ...row }) => ({
        ...row,
        plan: planOf(subscription ?? undefined).status,
      })),
      total: total?.value ?? 0,
    };
  });

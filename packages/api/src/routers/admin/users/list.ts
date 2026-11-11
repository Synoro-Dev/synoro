import {
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  Practice,
  SignIn,
  type SQL,
  Subscription,
  sql,
  user,
} from "@synoro/db";

import { planOf } from "../../../lib/billing";
import { adminProcedure } from "../../../orpc";
import { containsPattern } from "../contains";
import { pageInput } from "../page-input";
import { sourceKind } from "../sign-ins/source";

/** A first sign-in this soon after the registration is the sign-up itself. */
const SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Registered users, newest first, with their «Про» plan and the practices
 * they own (`practices` counts them, `practiceList` names them, oldest first). `query` matches name, email or phone anywhere.
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

    const owned = rows.length
      ? await context.db
          .select({
            ownerId: Practice.ownerId,
            name: Practice.name,
            slug: Practice.slug,
          })
          .from(Practice)
          .where(
            inArray(
              Practice.ownerId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(Practice.createdAt, Practice.id)
      : [];

    // Where each user came from is the source of their first sign-in —
    // the one that opened the registration session.
    const origins = rows.length
      ? await context.db
          .selectDistinctOn([SignIn.userId], {
            userId: SignIn.userId,
            createdAt: SignIn.createdAt,
            yclid: SignIn.yclid,
            utmSource: SignIn.utmSource,
            utmMedium: SignIn.utmMedium,
            utmCampaign: SignIn.utmCampaign,
            utmContent: SignIn.utmContent,
            utmTerm: SignIn.utmTerm,
            referrerHost: SignIn.referrerHost,
          })
          .from(SignIn)
          .where(
            inArray(
              SignIn.userId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(SignIn.userId), asc(SignIn.createdAt), asc(SignIn.id))
      : [];
    const originByUser = new Map(origins.map((o) => [o.userId, o]));

    return {
      items: rows.map(({ subscription, ...row }) => {
        const origin = originByUser.get(row.id);
        const atSignup =
          origin &&
          origin.createdAt.getTime() - row.createdAt.getTime() <=
            SIGNUP_WINDOW_MS;
        return {
          ...row,
          plan: planOf(subscription ?? undefined).status,
          practiceList: owned
            .filter((practice) => practice.ownerId === row.id)
            .map(({ name, slug }) => ({ name, slug })),
          source: atSignup
            ? {
                kind: sourceKind(origin),
                yclid: origin.yclid,
                utmSource: origin.utmSource,
                utmMedium: origin.utmMedium,
                utmCampaign: origin.utmCampaign,
                utmContent: origin.utmContent,
                utmTerm: origin.utmTerm,
                referrerHost: origin.referrerHost,
              }
            : null,
        };
      }),
      total: total?.value ?? 0,
    };
  });

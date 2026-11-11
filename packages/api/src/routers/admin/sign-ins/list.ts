import {
  and,
  count,
  desc,
  eq,
  ilike,
  or,
  SignIn,
  type SQL,
  user,
} from "@synoro/db";
import { z } from "zod";

import { adminProcedure } from "../../../orpc";
import { containsPattern } from "../contains";
import { pageInput } from "../page-input";
import { sourceCondition, sourceKind } from "./source";

/**
 * The history of sign-ins, newest first: who, when, from which IP and city,
 * and where they came from (an ad with its UTM tags, or the referring site).
 * `query` matches the user's name or email, the IP or the city; `userId`
 * narrows to one user, `source` to ads, referrals or direct visits.
 *
 * @example client.admin.signIns.list({ source: "ad", limit: 50, offset: 0 })
 */
export const list = adminProcedure
  .input(
    pageInput.extend({
      userId: z.string().min(1).optional(),
      source: z.enum(["ad", "referral", "direct"]).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const filters: (SQL | undefined)[] = [];
    if (input.userId) filters.push(eq(SignIn.userId, input.userId));
    if (input.source) filters.push(sourceCondition(input.source));
    if (input.query) {
      const pattern = containsPattern(input.query);
      filters.push(
        or(
          ilike(user.name, pattern),
          ilike(user.email, pattern),
          ilike(SignIn.ipAddress, pattern),
          ilike(SignIn.city, pattern),
        ),
      );
    }
    const where = and(...filters);

    const rows = await context.db
      .select({
        id: SignIn.id,
        createdAt: SignIn.createdAt,
        method: SignIn.method,
        impersonatedBy: SignIn.impersonatedBy,
        ipAddress: SignIn.ipAddress,
        userAgent: SignIn.userAgent,
        country: SignIn.country,
        region: SignIn.region,
        city: SignIn.city,
        yclid: SignIn.yclid,
        utmSource: SignIn.utmSource,
        utmMedium: SignIn.utmMedium,
        utmCampaign: SignIn.utmCampaign,
        utmContent: SignIn.utmContent,
        utmTerm: SignIn.utmTerm,
        referrerHost: SignIn.referrerHost,
        landingPath: SignIn.landingPath,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      })
      .from(SignIn)
      .innerJoin(user, eq(user.id, SignIn.userId))
      .where(where)
      .orderBy(desc(SignIn.createdAt), desc(SignIn.id))
      .limit(input.limit)
      .offset(input.offset);

    const [total] = await context.db
      .select({ value: count() })
      .from(SignIn)
      .innerJoin(user, eq(user.id, SignIn.userId))
      .where(where);

    return {
      items: rows.map((row) => ({ ...row, source: sourceKind(row) })),
      total: total?.value ?? 0,
    };
  });

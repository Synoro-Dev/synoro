import {
  and,
  asc,
  Booking,
  eq,
  gte,
  Practice,
  PracticeMember,
} from "@synoro/db";

import { CLIENT_CANCEL_WINDOW_MS } from "../../lib/schedule";
import { protectedProcedure } from "../../orpc";

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The caller's consultations in every practice: upcoming ones and those of
 * the last 30 days, including cancelled. `canCancel` tells whether the
 * client may still cancel it themselves (24 h rule).
 *
 * @example client.booking.mine()
 */
export const mine = protectedProcedure.handler(async ({ context }) => {
  const now = Date.now();
  const rows = await context.db
    .select({
      id: Booking.id,
      status: Booking.status,
      startsAt: Booking.startsAt,
      endsAt: Booking.endsAt,
      practiceId: Practice.id,
      practiceName: Practice.name,
      practiceSlug: Practice.slug,
      timezone: Practice.timezone,
    })
    .from(Booking)
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .where(
      and(
        eq(PracticeMember.userId, context.session.user.id),
        eq(Booking.kind, "consultation"),
        gte(Booking.startsAt, new Date(now - RECENT_MS)),
      ),
    )
    .orderBy(asc(Booking.startsAt));

  return rows.map((row) => ({
    ...row,
    canCancel:
      row.status === "active" &&
      row.startsAt.getTime() - now >= CLIENT_CANCEL_WINDOW_MS,
  }));
});

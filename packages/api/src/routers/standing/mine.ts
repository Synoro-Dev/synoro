import {
  and,
  asc,
  Booking,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  Practice,
  PracticeMember,
  StandingTime,
} from "@synoro/db";

import { protectedProcedure } from "../../orpc";

/**
 * The caller's standing times that are not ended, in every practice: when
 * they start, how often, whether they are running or paused (a hold ran out
 * unpaid), the next date and how many dates wait for a payment.
 *
 * @example client.standing.mine()
 */
export const mine = protectedProcedure.handler(async ({ context }) => {
  const rows = await context.db
    .select({
      id: StandingTime.id,
      startsAt: StandingTime.startsAt,
      intervalWeeks: StandingTime.intervalWeeks,
      pausedAt: StandingTime.pausedAt,
      practiceId: Practice.id,
      practiceName: Practice.name,
      practiceSlug: Practice.slug,
      timezone: Practice.timezone,
      profession: Practice.profession,
    })
    .from(StandingTime)
    .innerJoin(PracticeMember, eq(PracticeMember.id, StandingTime.memberId))
    .innerJoin(Practice, eq(Practice.id, StandingTime.practiceId))
    .where(
      and(
        eq(PracticeMember.userId, context.session.user.id),
        isNull(StandingTime.endedAt),
      ),
    )
    .orderBy(asc(StandingTime.createdAt));
  if (rows.length === 0) return [];

  const upcoming = await context.db
    .select({
      standingId: Booking.standingId,
      startsAt: Booking.startsAt,
      held: isNotNull(Booking.holdUntil),
    })
    .from(Booking)
    .where(
      and(
        inArray(
          Booking.standingId,
          rows.map((r) => r.id),
        ),
        eq(Booking.status, "active"),
        gt(Booking.startsAt, new Date()),
      ),
    )
    .orderBy(asc(Booking.startsAt));

  return rows.map(({ pausedAt, ...row }) => {
    const own = upcoming.filter((b) => b.standingId === row.id);
    return {
      ...row,
      paused: pausedAt !== null,
      /** The next date that stands, paid or held. */
      nextAt: own[0]?.startsAt ?? null,
      /** Dates held until the package is paid. */
      unpaid: own.filter((b) => b.held).length,
    };
  });
});

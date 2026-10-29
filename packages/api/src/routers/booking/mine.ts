import {
  and,
  asc,
  Booking,
  eq,
  gt,
  gte,
  isNull,
  or,
  Practice,
  PracticeMember,
} from "@synoro/db";

import { CLIENT_CANCEL_WINDOW_MS } from "../../lib/schedule";
import { protectedProcedure } from "../../orpc";

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The caller's paid bookings in every practice: upcoming ones and those of
 * the last 30 days, including cancelled and those awaiting payment. `canCancel` tells whether the
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
      cancelReason: Booking.cancelReason,
      startsAt: Booking.startsAt,
      endsAt: Booking.endsAt,
      holdUntil: Booking.holdUntil,
      meetingUrl: Booking.meetingUrl,
      practiceVideoUrl: Practice.videoUrl,
      practiceId: Practice.id,
      practiceName: Practice.name,
      practiceSlug: Practice.slug,
      timezone: Practice.timezone,
      profession: Practice.profession,
    })
    .from(Booking)
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .where(
      and(
        eq(PracticeMember.userId, context.session.user.id),
        eq(Booking.kind, "consultation"),
        gte(Booking.startsAt, new Date(now - RECENT_MS)),
        // Unpaid holds that ran out never were bookings.
        or(isNull(Booking.holdUntil), gt(Booking.holdUntil, new Date(now))),
      ),
    )
    .orderBy(asc(Booking.startsAt));

  return rows.map(({ holdUntil, meetingUrl, practiceVideoUrl, ...row }) => ({
    ...row,
    /** The video room of a confirmed booking; null while unpaid or cancelled. */
    videoUrl:
      row.status === "active" && holdUntil === null
        ? (meetingUrl ?? practiceVideoUrl)
        : null,
    /** Reserved, the online payment not finished yet. */
    awaitingPayment: holdUntil !== null && row.status === "active",
    canCancel:
      row.status === "active" &&
      holdUntil === null &&
      row.startsAt.getTime() - now >= CLIENT_CANCEL_WINDOW_MS,
  }));
});

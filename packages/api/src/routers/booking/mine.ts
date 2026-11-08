import {
  and,
  asc,
  Booking,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  or,
  Practice,
  PracticeMember,
} from "@synoro/db";

import { cancelTerms } from "../../lib/bookings";
import { protectedProcedure } from "../../orpc";

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The caller's bookings in every practice — paid ones and free intros
 * (`kind`): upcoming ones and those of the last 30 days, including cancelled
 * and those awaiting payment. `canCancel` tells whether the client may still
 * cancel or move it themselves (24 h rule; an intro, or a booking paid at the
 * visit, until it starts). `charged`: something was taken from the balance
 * for it — false for intros and bookings paid at the visit.
 *
 * @example client.booking.mine()
 */
export const mine = protectedProcedure.handler(async ({ context }) => {
  const now = Date.now();
  const rows = await context.db
    .select({
      id: Booking.id,
      kind: Booking.kind,
      credits: Booking.credits,
      status: Booking.status,
      cancelReason: Booking.cancelReason,
      startsAt: Booking.startsAt,
      endsAt: Booking.endsAt,
      holdUntil: Booking.holdUntil,
      meetingUrl: Booking.meetingUrl,
      /** Set when the booking is part of a recurring booking. */
      seriesId: Booking.seriesId,
      practiceVideoUrl: Practice.videoUrl,
      practiceContact: Practice.clientContact,
      practiceId: Practice.id,
      practiceName: Practice.name,
      practiceSlug: Practice.slug,
      timezone: Practice.timezone,
      profession: Practice.profession,
      cancelHours: Practice.cancelHours,
      lateCancel: Practice.lateCancel,
    })
    .from(Booking)
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .where(
      and(
        eq(PracticeMember.userId, context.session.user.id),
        inArray(Booking.kind, ["consultation", "free"]),
        gte(Booking.startsAt, new Date(now - RECENT_MS)),
        // Unpaid holds that ran out never were bookings.
        or(isNull(Booking.holdUntil), gt(Booking.holdUntil, new Date(now))),
      ),
    )
    .orderBy(asc(Booking.startsAt));

  return rows.map(
    ({
      holdUntil,
      meetingUrl,
      practiceVideoUrl,
      practiceContact,
      cancelHours,
      lateCancel,
      ...row
    }) => {
      const confirmed = row.status === "active" && holdUntil === null;
      return {
        ...row,
        charged: row.credits > 0,
        /** The video room of a confirmed booking; null while unpaid or cancelled. */
        videoUrl: confirmed ? (meetingUrl ?? practiceVideoUrl) : null,
        /** How to reach the specialist, on a confirmed booking only. */
        contact: confirmed ? practiceContact : null,
        /** Reserved, the online payment not finished yet. */
        awaitingPayment: holdUntil !== null && row.status === "active",
        ...cancelTerms(confirmed, row, now, { cancelHours, lateCancel }),
      };
    },
  );
});

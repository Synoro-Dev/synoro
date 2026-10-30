import {
  AvailabilityRule,
  and,
  Booking,
  type BookingCancelReason,
  CreditEntry,
  type Database,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  or,
  PracticeMember,
  sql,
} from "@synoro/db";

import { notifyBookingCancelled } from "@synoro/jobs/booking-video";

import { removeBookingEvent } from "./google-calendar";
import { addDays, zonedTimeToUtc } from "./schedule";

export function loadRules(db: Database, practiceId: string) {
  return db
    .select({
      weekday: AvailabilityRule.weekday,
      startMinute: AvailabilityRule.startMinute,
      endMinute: AvailabilityRule.endMinute,
    })
    .from(AvailabilityRule)
    .where(eq(AvailabilityRule.practiceId, practiceId));
}

/** UTC bounds of `days` local days starting at `from` in `timeZone`. */
export function localDaysRange(from: string, days: number, timeZone: string) {
  return {
    start: zonedTimeToUtc(from, 0, timeZone),
    end: zonedTimeToUtc(addDays(from, days), 0, timeZone),
  };
}

/** An unpaid online booking holds its time for this long. */
export const HOLD_MS = 15 * 60 * 1000;

/**
 * Condition: a booking of the practice overlapping [start, end) that still
 * holds its time — active, and not an unpaid hold that ran out.
 */
export function activeBookingOverlaps(
  practiceId: string,
  start: Date,
  end: Date,
) {
  return and(
    eq(Booking.practiceId, practiceId),
    eq(Booking.status, "active"),
    or(isNull(Booking.holdUntil), gt(Booking.holdUntil, new Date())),
    lt(Booking.startsAt, end),
    gt(Booking.endsAt, start),
  );
}

/**
 * Cancel the practice's unpaid holds that ran out. The `bookings_no_overlap`
 * constraint still counts them while they are `active`, so everything that
 * inserts a booking calls this first. A payment that arrives afterwards only
 * tops up the balance (see `settlePayment`).
 */
export async function releaseExpiredHolds(db: Database, practiceId: string) {
  await db
    .update(Booking)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: "hold_expired",
    })
    .where(
      and(
        eq(Booking.practiceId, practiceId),
        eq(Booking.status, "active"),
        isNotNull(Booking.holdUntil),
        lt(Booking.holdUntil, new Date()),
      ),
    );
}

/**
 * Cancel an active booking and, when asked, give the consultation back to
 * the client's balance. Conditional on `active`, so two concurrent cancels
 * refund once. An unpaid hold has spent nothing, so it never refunds. The
 * booking's Google Calendar event, if any, is deleted, and the client and
 * staff are told (unless it was a no-show or a lapsed hold, or `notify` is
 * off — a series sends one mail for all its bookings).
 * Returns undefined when the booking wasn't active any more.
 */
export async function cancelActiveBooking(
  db: Database,
  bookingId: string,
  options: {
    cancelledById: string | null;
    refund: boolean;
    reason: BookingCancelReason;
    notify?: boolean;
  },
) {
  const [cancelled] = await db
    .update(Booking)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById: options.cancelledById,
      cancelReason: options.reason,
    })
    .where(and(eq(Booking.id, bookingId), eq(Booking.status, "active")))
    .returning();
  if (!cancelled) return undefined;

  const refunded =
    options.refund &&
    cancelled.kind === "consultation" &&
    cancelled.memberId !== null &&
    cancelled.holdUntil === null;
  if (refunded && cancelled.memberId) {
    await adjustCredits(db, cancelled.memberId, 1);
    await recordCredit(db, {
      memberId: cancelled.memberId,
      delta: 1,
      reason: "refund",
      bookingId: cancelled.id,
      createdById: options.cancelledById,
    });
  }
  await removeBookingEvent(db, cancelled);
  if (options.notify ?? true) {
    await notifyBookingCancelled(db, cancelled.id, { refunded });
  }
  return { booking: cancelled, refunded };
}

/**
 * Atomically change a member's balance by `delta`, never below zero.
 * Returns the new balance, or `undefined` when there weren't enough credits.
 */
export async function adjustCredits(
  db: Database,
  memberId: string,
  delta: number,
) {
  const [row] = await db
    .update(PracticeMember)
    .set({ credits: sql`${PracticeMember.credits} + ${delta}` })
    .where(
      and(
        eq(PracticeMember.id, memberId),
        gte(sql`${PracticeMember.credits} + ${delta}`, 0),
      ),
    )
    .returning({ credits: PracticeMember.credits });
  return row?.credits;
}

export async function recordCredit(
  db: Database,
  entry: typeof CreditEntry.$inferInsert,
) {
  await db.insert(CreditEntry).values(entry);
}

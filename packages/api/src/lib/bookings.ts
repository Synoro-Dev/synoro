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
import { notifyWaitlist } from "@synoro/jobs/waitlist";

import { removeBookingEvent } from "./google-calendar";
import { findMembership, isStaff } from "./practice-access";
import { addDays, clientMayCancel, zonedTimeToUtc } from "./schedule";

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
 * off — a series sends one mail for all its bookings), and so is the waiting
 * list (`notifyWaitlist`) when the time is still ahead.
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
    /** Only if it still starts then (see `cancelBookingRows`). */
    startsAt?: Date;
  },
) {
  const result = await cancelBookingRows(db, bookingId, options);
  if (!result) return undefined;
  await removeBookingEvent(db, result.booking);
  if (options.notify ?? true) {
    await notifyBookingCancelled(db, result.booking.id, {
      refunded: result.refunded,
    });
  }
  // The freed time goes to those waiting for one; not to whoever gave it up.
  await notifyWaitlist(db, {
    practiceId: result.booking.practiceId,
    startsAt: result.booking.startsAt,
    endsAt: result.booking.endsAt,
    exceptUserId: options.cancelledById,
  });
  return result;
}

/** Why `userId` can't cancel a booking (`checkCancel`, `cancelBookingAs`). */
export type CancelRefusal = "NOT_FOUND" | "TOO_LATE";

type Refused = { refusal: CancelRefusal };
type BookingRow = typeof Booking.$inferSelect;

/**
 * Whether `userId` may cancel `bookingId` now, and as whom. A client cancels
 * their own booking — a consultation no later than 24 h before it, a free
 * intro any time before it starts; staff cancel anything at any time.
 * Bookings the user may not touch, and ones no longer active, are NOT_FOUND.
 * `booking.cancel` and the messenger's «Отменить запись» share it.
 */
export async function checkCancel(
  db: Database,
  bookingId: string,
  userId: string,
): Promise<Refused | { booking: BookingRow; staff: boolean }> {
  const booking = await db.query.Booking.findFirst({
    where: and(eq(Booking.id, bookingId), eq(Booking.status, "active")),
  });
  if (!booking) return { refusal: "NOT_FOUND" };

  const caller = await findMembership(db, booking.practiceId, userId);
  const staff = caller !== undefined && isStaff(caller.role);
  const own =
    caller !== undefined &&
    booking.kind !== "blocked" &&
    booking.memberId === caller.id;
  if (!staff && !own) return { refusal: "NOT_FOUND" };
  if (!staff && !clientMayCancel(booking, Date.now())) {
    return { refusal: "TOO_LATE" };
  }
  return { booking, staff };
}

/**
 * Whether `userId` may move `bookingId` now: the rules of `checkCancel`, for
 * confirmed bookings only — closed time and unpaid holds are NOT_FOUND. A
 * booking keeps its length (`minutes`), whatever the practice's intro is now.
 */
export async function checkMove(
  db: Database,
  bookingId: string,
  userId: string,
) {
  const check = await checkCancel(db, bookingId, userId);
  if ("refusal" in check) return check;
  const { booking, staff } = check;
  if (booking.kind === "blocked" || booking.holdUntil !== null) {
    return { refusal: "NOT_FOUND" } satisfies Refused;
  }
  const minutes =
    (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
  return { booking, kind: booking.kind, staff, minutes };
}

/**
 * Cancel `bookingId` for `userId` by the rules of `checkCancel`. A client
 * always gets the consultation back; staff unless `refund` is false (a late
 * cancellation). The client and staff are told as by `cancelActiveBooking`.
 * A client's verdict holds for the time it was given at: if staff moved the
 * booking meanwhile, the rules are asked again and nothing is cancelled.
 */
export async function cancelBookingAs(
  db: Database,
  bookingId: string,
  userId: string,
  options: { refund?: boolean } = {},
): Promise<Refused | { booking: BookingRow; refunded: boolean }> {
  const check = await checkCancel(db, bookingId, userId);
  if ("refusal" in check) return check;
  const { booking, staff } = check;
  const result = await cancelActiveBooking(db, booking.id, {
    cancelledById: userId,
    refund: (options.refund ?? true) || !staff,
    reason: staff ? "staff" : "client",
    startsAt: staff ? undefined : booking.startsAt,
  });
  if (!result) {
    const again = await checkCancel(db, bookingId, userId);
    return "refusal" in again ? again : { refusal: "NOT_FOUND" };
  }
  return { booking: result.booking, refunded: result.refunded };
}

/**
 * The database half of `cancelActiveBooking`: the booking, the balance and
 * the credit log — nothing outside the database, so it can run in a
 * transaction (pass `tx` as `db`) and be rolled back as a whole. The caller
 * removes the calendar event and sends the mails after the commit. `startsAt`:
 * the time a client's 24-hour check was made for; a booking moved since stays.
 */
export async function cancelBookingRows(
  db: Database,
  bookingId: string,
  options: {
    cancelledById: string | null;
    refund: boolean;
    reason: BookingCancelReason;
    startsAt?: Date;
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
    .where(
      and(
        eq(Booking.id, bookingId),
        eq(Booking.status, "active"),
        options.startsAt ? eq(Booking.startsAt, options.startsAt) : undefined,
      ),
    )
    .returning();
  if (!cancelled) return undefined;

  const refunded =
    options.refund &&
    cancelled.kind === "consultation" &&
    cancelled.credits > 0 &&
    cancelled.memberId !== null &&
    cancelled.holdUntil === null;
  if (refunded && cancelled.memberId) {
    await adjustCredits(db, cancelled.memberId, cancelled.credits);
    await recordCredit(db, {
      memberId: cancelled.memberId,
      delta: cancelled.credits,
      reason: "refund",
      bookingId: cancelled.id,
      createdById: options.cancelledById,
    });
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

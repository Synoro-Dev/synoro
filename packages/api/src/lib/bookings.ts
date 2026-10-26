import {
  AvailabilityRule,
  and,
  Booking,
  CreditEntry,
  type Database,
  eq,
  gt,
  gte,
  lt,
  PracticeMember,
  sql,
} from "@acme/db";

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

/** Condition: an active booking of the practice overlapping [start, end). */
export function activeBookingOverlaps(
  practiceId: string,
  start: Date,
  end: Date,
) {
  return and(
    eq(Booking.practiceId, practiceId),
    eq(Booking.status, "active"),
    lt(Booking.startsAt, end),
    gt(Booking.endsAt, start),
  );
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

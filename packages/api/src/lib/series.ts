import {
  and,
  Booking,
  type Database,
  eq,
  type MemberRole,
  PracticeMember,
} from "@synoro/db";

import { activeBookingOverlaps, loadRules } from "./bookings";
import { googleBusy } from "./google-calendar";
import { isStaff } from "./practice-access";
import {
  isScheduledSlot,
  overlaps,
  SLOT_MINUTES,
  seriesSlots,
  type TimeRange,
} from "./schedule";

/**
 * free         — can be booked;
 * past         — already started;
 * off_schedule — outside the practice's working hours;
 * booked       — someone else holds the time;
 * google_busy  — the specialist is busy in Google Calendar (clients only).
 */
type SeriesDateStatus =
  | "free"
  | "past"
  | "off_schedule"
  | "booked"
  | "google_busy";

export const SERIES_MAX = 12;

/**
 * The bookings a series starting at `startsAt` would make, each with whether
 * it can be booked. One query for the bookings and one Google lookup cover
 * the whole span. `checkGoogle` is off for staff, who see the specialist's
 * calendar themselves (as in `book` and `bookFree`).
 */
export async function previewSeries(
  db: Database,
  practice: { id: string; timezone: string },
  series: { startsAt: Date; intervalWeeks: number; count: number },
  options: { checkGoogle: boolean },
) {
  const length = SLOT_MINUTES.consultation * 60_000;
  const slots = seriesSlots(
    series.startsAt,
    series.intervalWeeks,
    series.count,
    practice.timezone,
  );
  const ranges: (TimeRange & { exists: boolean })[] = slots.map(
    ({ startsAt, exists }) => ({
      startsAt,
      endsAt: new Date(startsAt.getTime() + length),
      exists,
    }),
  );
  const first = ranges[0];
  const last = ranges.at(-1);
  if (!first || !last) return [];

  const now = new Date();
  const [rules, taken, external] = await Promise.all([
    loadRules(db, practice.id),
    db
      .select({ startsAt: Booking.startsAt, endsAt: Booking.endsAt })
      .from(Booking)
      .where(activeBookingOverlaps(practice.id, first.startsAt, last.endsAt)),
    options.checkGoogle
      ? googleBusy(db, practice.id, first.startsAt, last.endsAt)
      : Promise.resolve([]),
  ]);

  return ranges.map((range) => {
    let status: SeriesDateStatus = "free";
    if (range.startsAt <= now) status = "past";
    else if (
      // A wall time skipped by a DST jump is not on the schedule either.
      !range.exists ||
      !isScheduledSlot({
        rules,
        startsAt: range.startsAt,
        timeZone: practice.timezone,
        kind: "consultation",
        now,
      })
    ) {
      status = "off_schedule";
    } else if (taken.some((b) => overlaps(b, range))) status = "booked";
    else if (external.some((b) => overlaps(b, range))) status = "google_busy";
    return { startsAt: range.startsAt, endsAt: range.endsAt, status };
  });
}

/**
 * Whose series it is: a client books for themselves; staff pass `memberId`
 * to book a client of the practice. Mirrors `book`.
 */
export async function seriesMember<
  M extends { id: string; role: MemberRole; credits: number },
>(db: Database, practiceId: string, caller: M, memberId: string | undefined) {
  const staff = isStaff(caller.role);
  const forOther = memberId !== undefined && memberId !== caller.id;
  if (forOther && !staff) return { error: "FORBIDDEN" as const };
  const member = forOther
    ? await db.query.PracticeMember.findFirst({
        where: and(
          eq(PracticeMember.id, memberId),
          eq(PracticeMember.practiceId, practiceId),
          eq(PracticeMember.role, "client"),
        ),
      })
    : caller;
  if (!member) return { error: "NOT_FOUND" as const };
  return { member, staff, forOther };
}

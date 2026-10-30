/**
 * Pure scheduling math: time zones and the slot grid. No database access, so
 * it is unit tested on its own (`schedule.test.ts`).
 *
 * Availability rules are written in the practice's local time (minutes since
 * local midnight, ISO weekday); bookings are stored as UTC instants.
 */

export type SlotKind = "consultation" | "free";

/** Paid consultations take an hour on the hour; free ones half an hour. */
export const SLOT_MINUTES: Record<SlotKind, number> = {
  consultation: 60,
  free: 30,
};

/** A client may cancel (and get the credit back) up to 24 h before start. */
export const CLIENT_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface Rule {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface TimeRange {
  startsAt: Date;
  endsAt: Date;
}

function parseDate(date: string) {
  const [y = Number.NaN, m = Number.NaN, d = Number.NaN] = date
    .split("-")
    .map(Number);
  return { y, m, d };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(at: Date, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at the instant `at`, in ms (Moscow: +3 h). */
function zoneOffsetMs(at: Date, timeZone: string) {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of local `date` (YYYY-MM-DD) + `minute` in `timeZone`. */
export function zonedTimeToUtc(date: string, minute: number, timeZone: string) {
  const { y, m, d } = parseDate(date);
  const wallClock = Date.UTC(y, m - 1, d, 0, minute);
  // Two passes settle the offset around DST transitions.
  const first = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  return new Date(wallClock - zoneOffsetMs(new Date(first), timeZone));
}

/** Local calendar date (YYYY-MM-DD) of the instant `at` in `timeZone`. */
export function toZonedDate(at: Date, timeZone: string) {
  const p = zonedParts(at, timeZone);
  return [p.year, p.month, p.day]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, "0"))
    .join("-");
}

export function addDays(date: string, days: number) {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string) {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

export function overlaps(a: TimeRange, b: TimeRange) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Parts of `ranges` not covered by any of `cut`, sorted by start. Ranges
 * that overlap each other are merged first.
 */
export function subtractRanges(ranges: TimeRange[], cut: TimeRange[]) {
  const merged: TimeRange[] = [];
  for (const r of [...ranges].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  )) {
    const last = merged.at(-1);
    if (last && r.startsAt <= last.endsAt) {
      if (r.endsAt > last.endsAt) last.endsAt = r.endsAt;
    } else {
      merged.push({ startsAt: r.startsAt, endsAt: r.endsAt });
    }
  }

  const sortedCut = [...cut].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const result: TimeRange[] = [];
  for (const range of merged) {
    let cursor = range.startsAt;
    for (const c of sortedCut) {
      if (c.endsAt <= cursor || c.startsAt >= range.endsAt) continue;
      if (c.startsAt > cursor) {
        result.push({ startsAt: cursor, endsAt: c.startsAt });
      }
      if (c.endsAt > cursor) cursor = c.endsAt;
    }
    if (cursor < range.endsAt) {
      result.push({ startsAt: cursor, endsAt: range.endsAt });
    }
  }
  return result;
}

/**
 * Starts of a recurring booking: `count` dates every `intervalWeeks` weeks,
 * keeping the local wall time of `first` in `timeZone` — the days are added
 * on the local calendar, so 19:00 stays 19:00 across a DST change.
 */
export function seriesStarts(
  first: Date,
  intervalWeeks: number,
  count: number,
  timeZone: string,
) {
  const date = toZonedDate(first, timeZone);
  const { hour, minute } = zonedParts(first, timeZone);
  return Array.from({ length: count }, (_, i) =>
    zonedTimeToUtc(
      addDays(date, i * 7 * intervalWeeks),
      hour * 60 + minute,
      timeZone,
    ),
  );
}

/** True when `at` sits on the 30-minute grid (whole minutes, :00 or :30). */
export function isOnHalfHourGrid(at: Date) {
  return at.getTime() % (30 * MINUTE_MS) === 0;
}

/**
 * Bookable slots of `kind` for `days` local days starting at `from`.
 *
 * Slots are aligned to their own length from local midnight (paid: :00,
 * free: :00 and :30), lie fully inside a rule, start after `now`, and don't
 * overlap any `busy` range. Overlapping rules don't produce duplicates.
 */
export function computeSlots(opts: {
  rules: Rule[];
  busy: TimeRange[];
  from: string;
  days: number;
  timeZone: string;
  kind: SlotKind;
  now: Date;
}): TimeRange[] {
  const length = SLOT_MINUTES[opts.kind];
  const slots = new Map<number, TimeRange>();

  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.from, i);
    const weekday = isoWeekday(date);

    for (const rule of opts.rules) {
      if (rule.weekday !== weekday) continue;
      const first = Math.ceil(rule.startMinute / length) * length;

      for (let m = first; m + length <= rule.endMinute; m += length) {
        const startsAt = zonedTimeToUtc(date, m, opts.timeZone);
        const slot = {
          startsAt,
          endsAt: new Date(startsAt.getTime() + length * MINUTE_MS),
        };
        if (startsAt <= opts.now) continue;
        if (opts.busy.some((b) => overlaps(slot, b))) continue;
        slots.set(startsAt.getTime(), slot);
      }
    }
  }

  return [...slots.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

/**
 * Whether a `kind` slot starting at `startsAt` exists in the schedule,
 * ignoring existing bookings (the database rejects overlaps itself).
 */
export function isScheduledSlot(opts: {
  rules: Rule[];
  startsAt: Date;
  timeZone: string;
  kind: SlotKind;
  now: Date;
}) {
  const from = toZonedDate(opts.startsAt, opts.timeZone);
  return computeSlots({ ...opts, busy: [], from, days: 1 }).some(
    (s) => s.startsAt.getTime() === opts.startsAt.getTime(),
  );
}

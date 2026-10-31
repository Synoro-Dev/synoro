import {
  and,
  Booking,
  count,
  type Database,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  Payment,
  sql,
} from "@synoro/db";

export interface Range {
  from: Date;
  to: Date;
}

/** Numbers of one window, see `docs/analytics.md`. */
export interface PeriodStats {
  /** Paid consultations that took place. */
  meetings: number;
  /** Free introductory meetings that took place. */
  intros: number;
  /** Hours the specialist spent in those meetings. */
  hours: number;
  cancelledByClient: number;
  cancelledByStaff: number;
  noShows: number;
  /** No-shows among everything planned and not cancelled in time, or null. */
  noShowRate: number | null;
  /** Online payments received, kopecks. */
  revenue: number;
  payments: number;
  /** Clients with at least one consultation in the window. */
  activeClients: number;
  /** Of them, those whose first consultation ever fell into the window. */
  newClients: number;
}

/** A timestamp literal for raw SQL (Dates are not passed as parameters). */
const ts = (at: Date) => sql`${at.toISOString()}::timestamptz`;

/**
 * Bookings that count: meetings that took place (active, paid, over) and
 * cancellations someone decided on. Unpaid holds that lapsed are not either.
 */
function counted(now: Date) {
  return or(
    and(
      eq(Booking.status, "active"),
      isNull(Booking.holdUntil),
      lte(Booking.endsAt, now),
    ),
    and(
      eq(Booking.status, "cancelled"),
      inArray(Booking.cancelReason, ["client", "staff", "no_show"]),
    ),
  );
}

function bookingsIn(practiceId: string, range: Range, now: Date) {
  return and(
    eq(Booking.practiceId, practiceId),
    ne(Booking.kind, "blocked"),
    gte(Booking.startsAt, range.from),
    lt(Booking.startsAt, range.to),
    counted(now),
  );
}

function paymentsIn(practiceId: string, range: Range) {
  return and(
    eq(Payment.practiceId, practiceId),
    eq(Payment.status, "succeeded"),
    gte(Payment.paidAt, range.from),
    lt(Payment.paidAt, range.to),
  );
}

/** Everything the page shows as a single number, for one window. */
export async function periodStats(
  db: Database,
  practiceId: string,
  range: Range,
  now: Date,
): Promise<PeriodStats> {
  const perClient = db
    .select({
      firstAt: sql<Date>`min(${Booking.startsAt})`.as("first_at"),
      inPeriod:
        sql<boolean>`bool_or(${Booking.startsAt} >= ${ts(range.from)} and ${Booking.startsAt} < ${ts(range.to)})`.as(
          "in_period",
        ),
    })
    .from(Booking)
    .where(
      and(
        eq(Booking.practiceId, practiceId),
        isNotNull(Booking.memberId),
        eq(Booking.status, "active"),
        isNull(Booking.holdUntil),
        lte(Booking.endsAt, now),
      ),
    )
    .groupBy(Booking.memberId)
    .as("per_client");

  const [bookings, [payments], [clients]] = await Promise.all([
    db
      .select({
        kind: Booking.kind,
        status: Booking.status,
        reason: Booking.cancelReason,
        n: count(),
        seconds:
          sql<number>`coalesce(sum(extract(epoch from ${Booking.endsAt} - ${Booking.startsAt})), 0)`.mapWith(
            Number,
          ),
      })
      .from(Booking)
      .where(bookingsIn(practiceId, range, now))
      .groupBy(Booking.kind, Booking.status, Booking.cancelReason),
    db
      .select({
        amount: sql<number>`coalesce(sum(${Payment.amount}), 0)`.mapWith(
          Number,
        ),
        n: count(),
      })
      .from(Payment)
      .where(paymentsIn(practiceId, range)),
    db
      .select({
        active: count(),
        fresh:
          sql<number>`count(*) filter (where ${perClient.firstAt} >= ${ts(range.from)})`.mapWith(
            Number,
          ),
      })
      .from(perClient)
      .where(eq(perClient.inPeriod, true)),
  ]);

  let meetings = 0;
  let intros = 0;
  let seconds = 0;
  let cancelledByClient = 0;
  let cancelledByStaff = 0;
  let noShows = 0;
  for (const row of bookings) {
    if (row.status === "active") {
      if (row.kind === "free") intros += row.n;
      else meetings += row.n;
      seconds += row.seconds;
    } else if (row.reason === "client") cancelledByClient += row.n;
    else if (row.reason === "staff") cancelledByStaff += row.n;
    else if (row.reason === "no_show") noShows += row.n;
  }

  const planned = meetings + intros + noShows;
  return {
    meetings,
    intros,
    hours: Math.round((seconds / 3600) * 10) / 10,
    cancelledByClient,
    cancelledByStaff,
    noShows,
    noShowRate: planned === 0 ? null : noShows / planned,
    revenue: payments?.amount ?? 0,
    payments: payments?.n ?? 0,
    activeClients: clients?.active ?? 0,
    newClients: clients?.fresh ?? 0,
  };
}

export type SeriesUnit = "day" | "week";

export interface SeriesPoint {
  /** Local date (`2026-11-03`); for weeks, the Monday. */
  date: string;
  meetings: number;
  revenue: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-11-03` in `timeZone`. */
function localDate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The Monday on or before `date`, like Postgres' `date_trunc('week')`. */
function mondayOf(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** A zone Postgres and `Intl` both know, else Moscow (the column default). */
export function usableTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    return "Europe/Moscow";
  }
}

/**
 * Meetings and online payments per day or week of `range`, in the practice's
 * time zone, with the empty ones filled in with zeros.
 */
export async function seriesStats(
  db: Database,
  practiceId: string,
  range: Range,
  now: Date,
  timeZone: string,
  unit: SeriesUnit,
): Promise<SeriesPoint[]> {
  const bucket = (column: typeof Booking.startsAt | typeof Payment.paidAt) =>
    sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${column} at time zone ${timeZone}), 'YYYY-MM-DD')`;

  const [meetingRows, paymentRows] = await Promise.all([
    db
      .select({ bucket: bucket(Booking.startsAt), n: count() })
      .from(Booking)
      .where(
        and(bookingsIn(practiceId, range, now), eq(Booking.status, "active")),
      )
      .groupBy(sql`1`),
    db
      .select({
        bucket: bucket(Payment.paidAt),
        amount: sql<number>`sum(${Payment.amount})`.mapWith(Number),
      })
      .from(Payment)
      .where(paymentsIn(practiceId, range))
      .groupBy(sql`1`),
  ]);

  const points = new Map<string, SeriesPoint>();
  const first = localDate(range.from, timeZone);
  const last = localDate(range.to, timeZone);
  const step = unit === "week" ? 7 : 1;
  for (
    let date = unit === "week" ? mondayOf(first) : first;
    date <= last;
    date = addDays(date, step)
  ) {
    points.set(date, { date, meetings: 0, revenue: 0 });
  }
  for (const row of meetingRows) {
    const point = points.get(row.bucket);
    if (point) point.meetings = row.n;
  }
  for (const row of paymentRows) {
    const point = points.get(row.bucket);
    if (point) point.revenue = row.amount;
  }
  return [...points.values()];
}

export interface LoadCell {
  /** 1 — Monday … 7 — Sunday. */
  weekday: number;
  hour: number;
  count: number;
}

/** When the meetings of `range` start: weekday and hour, practice time. */
export async function loadStats(
  db: Database,
  practiceId: string,
  range: Range,
  now: Date,
  timeZone: string,
): Promise<LoadCell[]> {
  const local = sql`${Booking.startsAt} at time zone ${timeZone}`;
  const rows = await db
    .select({
      weekday: sql<number>`extract(isodow from ${local})`.mapWith(Number),
      hour: sql<number>`extract(hour from ${local})`.mapWith(Number),
      count: count(),
    })
    .from(Booking)
    .where(
      and(bookingsIn(practiceId, range, now), eq(Booking.status, "active")),
    )
    .groupBy(sql`1`, sql`2`);
  return rows.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}

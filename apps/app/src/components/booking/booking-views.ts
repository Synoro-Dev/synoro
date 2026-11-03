/**
 * The ways the booking page lays out free time: a month with the hours of one
 * day, a week as a grid of hours × days, or a week of day columns. Pure date
 * math on YYYY-MM-DD keys, unit tested in `booking-views.test.ts`.
 */

const BOOKING_VIEWS = ["month", "week", "columns"] as const;

export type BookingView = (typeof BOOKING_VIEWS)[number];

export const isBookingView = (value: unknown): value is BookingView =>
  BOOKING_VIEWS.some((view) => view === value);

const DAY_MS = 86_400_000;

export const addDays = (key: string, days: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );

/** The Monday of the week `key` falls in. */
export function weekStart(key: string) {
  const weekday = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(key, -weekday);
}

/** The seven days of the week from `start`. */
export const weekDays = (start: string) =>
  Array.from({ length: 7 }, (_, day) => addDays(start, day));

/**
 * What `booking.slots` is asked for a week: from today (in the practice's
 * zone) or the Monday, to the Sunday, with a day of padding on each side —
 * the viewer's days may straddle the practice's.
 */
export function weekWindow(start: string, today: string) {
  const from = addDays(start < today ? today : start, -1);
  return { from, days: Math.max(1, daysBetween(from, addDays(start, 6)) + 2) };
}

/** «3–9 ноября», «27 октября – 2 ноября», across a new year with years. */
export function formatWeekRange(start: string) {
  const end = addDays(start, 6);
  const [a, b] = [start, end].map((key) => new Date(`${key}T12:00:00`));
  if (!a || !b) return "";
  const newYear = a.getFullYear() !== b.getFullYear();
  const dayMonth = (at: Date) =>
    at.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: newYear ? "numeric" : undefined,
    });
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${dayMonth(b)}`;
  return `${dayMonth(a)} – ${dayMonth(b)}`;
}

/** Every hour from the earliest to the latest one a slot starts in. */
export function hourSpan(starts: readonly Date[]) {
  if (starts.length === 0) return [];
  const hours = starts.map((at) => at.getHours());
  const first = Math.min(...hours);
  return Array.from(
    { length: Math.max(...hours) - first + 1 },
    (_, i) => first + i,
  );
}

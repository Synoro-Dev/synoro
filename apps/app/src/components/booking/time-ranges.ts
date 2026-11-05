import { dateKey, formatTime, zonedDayStart } from "./time";

const HALF_HOUR_MS = 30 * 60_000;

function dayLabel(at: Date, timeZone: string) {
  return at.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone,
  });
}

/**
 * The midnight `at` stands for, if any. Closing whole days rounds outward to
 * half hours, so in a :45 zone `at` is up to half an hour off midnight.
 */
function midnightAt(at: Date, timeZone: string) {
  const midnight = zonedDayStart(
    dateKey(new Date(at.getTime() + HALF_HOUR_MS - 1), timeZone),
    timeZone,
  );
  return Math.abs(at.getTime() - midnight.getTime()) < HALF_HOUR_MS
    ? midnight
    : null;
}

/**
 * Closed time in the practice's zone: «12 ноября», «с 12 по 14 ноября» for
 * whole days, «12 ноября, 10:00–12:00» for hours of one day.
 */
export function describeClosed(start: Date, end: Date, timeZone: string) {
  const firstDay = midnightAt(start, timeZone);
  const afterLastDay = midnightAt(end, timeZone);
  if (firstDay && afterLastDay) {
    const lastDay = new Date(afterLastDay.getTime() - 1);
    const first = dateKey(firstDay, timeZone);
    const last = dateKey(lastDay, timeZone);
    if (first === last) return dayLabel(firstDay, timeZone);
    const from =
      first.slice(0, 7) === last.slice(0, 7)
        ? firstDay.toLocaleDateString("ru-RU", { day: "numeric", timeZone })
        : dayLabel(firstDay, timeZone);
    return `с ${from} по ${dayLabel(lastDay, timeZone)}`;
  }
  const from = `${dayLabel(start, timeZone)}, ${formatTime(start, timeZone)}`;
  if (dateKey(start, timeZone) === dateKey(end, timeZone)) {
    return `${from}–${formatTime(end, timeZone)}`;
  }
  return `с ${from} по ${dayLabel(end, timeZone)}, ${formatTime(end, timeZone)}`;
}

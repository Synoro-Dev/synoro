/**
 * Date helpers for the booking UI. Dates the API takes (`from`) are calendar
 * days in the practice's time zone; times are shown in the viewer's own zone.
 */

export const WEEKDAY_NAMES = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of `at` in `timeZone` (the viewer's zone when omitted). */
export function dateKey(at: Date, timeZone?: string) {
  const cacheKey = timeZone ?? "";
  let formatter = dateKeyFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateKeyFormatters.set(cacheKey, formatter);
  }
  return formatter.format(at);
}

export function addDays(date: string, days: number) {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatTime(at: Date) {
  return at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(at: Date) {
  return at.toLocaleString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "пн, 2 нояб." for a YYYY-MM-DD key. */
export function formatDayHeading(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** 630 → "10:30"; 1440 → "24:00". */
export function minutesToTime(minutes: number) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Day columns for a week view: the `days` dates from `from`, plus any extra
 * viewer-local day an item spills into when the viewer's zone differs from
 * the practice's. Items are grouped by viewer-local day.
 */
export function groupIntoDays<T extends { startsAt: Date }>(
  items: T[],
  from: string,
  days: number,
) {
  const groups = new Map<string, T[]>();
  for (let i = 0; i < days; i++) groups.set(addDays(from, i), []);
  for (const item of items) {
    const key = dateKey(item.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

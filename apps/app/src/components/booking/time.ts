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

/** 630 → "10:30"; 1440 → "24:00". */
export function minutesToTime(minutes: number) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

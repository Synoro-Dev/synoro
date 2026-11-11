/**
 * Date helpers for the booking UI. Dates the API takes (`from`) are calendar
 * days in the practice's time zone; times are shown in the viewer's own zone,
 * or the one they picked (`useDisplayZone`).
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

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A formatter of zone names (`timeZoneName`) in `locale`, kept per zone: the
 * zone list asks for hundreds, and building a formatter is the slow part.
 * Only the formatter is kept; names and offsets are read for a date each time.
 */
function zoneFormatter(
  locale: string,
  timeZone: string | undefined,
  timeZoneName: "shortGeneric" | "shortOffset",
) {
  const cacheKey = `${locale}|${timeZone ?? ""}|${timeZoneName}`;
  let formatter = zoneFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName });
    zoneFormatters.set(cacheKey, formatter);
  }
  return formatter;
}

/** A zone in words: «Москва» for Europe/Moscow (the viewer's when omitted). */
export function viewerTimeZoneName(timeZone?: string) {
  const part = zoneFormatter("ru-RU", timeZone, "shortGeneric")
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone ?? viewerTimeZone();
}

/** «UTC+7» for Asia/Novosibirsk, «UTC» for UTC, «UTC+5:30». */
function utcOffset(timeZone: string, at: Date) {
  const part = zoneFormatter("en-US", timeZone, "shortOffset")
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return (part?.value ?? "GMT").replace("GMT", "UTC").replace("−", "-");
}

/** Minutes east of UTC of `timeZone` at `at`, to sort the zones by. */
function offsetMinutes(timeZone: string, at: Date) {
  const match = /([+-])(\d{1,2})(?::(\d{2}))?$/.exec(utcOffset(timeZone, at));
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** The next calendar date after `date` (YYYY-MM-DD). */
export function nextDate(date: string) {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The instant the calendar day `date` (YYYY-MM-DD) begins in `timeZone`. */
export function zonedDayStart(date: string, timeZone: string) {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const wallClock = Date.UTC(y, m - 1, d);
  const at = (offsetFrom: number) =>
    wallClock - offsetMinutes(timeZone, new Date(offsetFrom)) * 60_000;
  // Two passes settle the offset around DST transitions.
  const first = at(wallClock);
  const second = new Date(at(first));
  // Where the clock jumps over midnight, the day begins at the jump: the
  // second pass lands in the evening before.
  return dateKey(second, timeZone) === date ? second : new Date(first);
}

export interface TimeZoneOption {
  value: string;
  /** «Новосибирск (UTC+7)». */
  label: string;
}

/**
 * Every zone the browser knows, west to east, named in Russian. Zones that
 * read the same (a city and its alias) are listed once.
 */
export function timeZoneOptions(extra: string[] = []): TimeZoneOption[] {
  const at = new Date();
  // `Etc/GMT+5` and the like are for machines: «UTC» stands for all of them.
  const zones = new Set([
    ...Intl.supportedValuesOf("timeZone").filter((z) => !z.startsWith("Etc/")),
    "UTC",
    ...extra,
  ]);
  const seen = new Set<string>();
  return [...zones]
    .map((value) => ({
      value,
      label: `${viewerTimeZoneName(value)} (${utcOffset(value, at)})`,
      offset: offsetMinutes(value, at),
    }))
    .sort(
      (a, b) =>
        a.offset - b.offset ||
        a.label.localeCompare(b.label, "ru") ||
        a.value.localeCompare(b.value),
    )
    .filter(({ label, value }) => {
      // A zone in use stays even if another one reads the same.
      if (extra.includes(value)) return true;
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .map(({ value, label }) => ({ value, label }));
}

export function formatTime(at: Date, timeZone?: string) {
  return at.toLocaleTimeString("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(at: Date, timeZone?: string) {
  return at.toLocaleString("ru-RU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** Hour (0–23) and minute of `at` on the wall clock of `timeZone`. */
export function clockIn(at: Date, timeZone?: string) {
  const cacheKey = timeZone ?? "";
  let formatter = clockFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "numeric",
      minute: "numeric",
    });
    clockFormatters.set(cacheKey, formatter);
  }
  const parts = formatter.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { hour: get("hour"), minute: get("minute") };
}

/** 630 → "10:30"; 1440 → "24:00". */
export function minutesToTime(minutes: number) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

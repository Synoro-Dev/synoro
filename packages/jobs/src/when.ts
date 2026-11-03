/**
 * How booking times read in mails: in the practice's time zone for its staff,
 * in the client's own zone — named, so nobody has to guess — for the client.
 */

/** «Москва» for Europe/Moscow, «Новосибирск», «Нью-Йорк». */
export function zoneName(at: Date, timeZone: string) {
  const part = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    timeZoneName: "shortGeneric",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** «вторник, 3 ноября, 19:00»; `named` adds the zone: «… 19:00 (Москва)». */
function formatWhen(at: Date, timeZone: string, named: boolean) {
  const text = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return named ? `${text} (${zoneName(at, timeZone)})` : text;
}

/** «19:15», or «19:15 (Москва)» when `named`. */
export function formatClock(at: Date, timeZone: string, named = false) {
  const text = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return named ? `${text} (${zoneName(at, timeZone)})` : text;
}

function meetings(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} встреча`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} встречи`;
  }
  return `${n} встреч`;
}

/**
 * `when` and `dates` for a mail about one booking or several (a series):
 * one date reads as it is, several as «8 встреч, первая — …» plus the list.
 * With `named` the zone is written once, after the date `when` shows.
 */
export function describeDates(
  dates: Date[],
  timeZone: string,
  options: { named?: boolean } = {},
) {
  const named = options.named ?? false;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const listed = sorted.map((at) => formatWhen(at, timeZone, false));
  const [firstAt] = sorted;
  const first = firstAt ? formatWhen(firstAt, timeZone, named) : "";
  return listed.length > 1
    ? { when: `${meetings(listed.length)}, первая — ${first}`, dates: listed }
    : { when: first, dates: [] };
}

/** Hour of the day (0–23) at `at` in `timeZone`; throws on an unknown zone. */
export function localHour(at: Date, timeZone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(at),
  );
}

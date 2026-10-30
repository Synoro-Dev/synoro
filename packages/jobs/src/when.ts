/** How booking times read in mails: in the practice's time zone. */

/** «вторник, 3 ноября, 19:00». */
function formatWhen(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
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
 */
export function describeDates(dates: Date[], timeZone: string) {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const listed = sorted.map((at) => formatWhen(at, timeZone));
  const [first = ""] = listed;
  return listed.length > 1
    ? { when: `${meetings(listed.length)}, первая — ${first}`, dates: listed }
    : { when: first, dates: [] };
}

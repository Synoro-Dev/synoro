/**
 * iCalendar text for `calendar.ics` in the archive and the subscription feed.
 * Times go out in UTC; a calendar shows them in its owner's zone.
 */

export interface CalendarEvent {
  id: string;
  startsAt: Date;
  endsAt: Date;
  cancelled: boolean;
  summary: string;
  description?: string | null;
  url?: string | null;
}

/** 20261105T150000Z */
function stamp(at: Date) {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function icsText(text: string) {
  return text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * RFC 5545 limits a line to 75 octets: longer ones continue on the next line
 * after a space. Counted in bytes, and never cuts a character in two.
 */
function fold(line: string) {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    // A continuation line starts with a space, which counts too.
    if (size + width > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildCalendar(
  name: string,
  events: CalendarEvent[],
  now = new Date(),
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Synoro//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
    // Calendars that honour these ask for updates hourly; Google decides itself.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@synoro.ru`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(event.startsAt)}`,
      `DTEND:${stamp(event.endsAt)}`,
      `SUMMARY:${icsText(event.summary)}`,
      `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    );
    if (event.description) {
      lines.push(`DESCRIPTION:${icsText(event.description)}`);
    }
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

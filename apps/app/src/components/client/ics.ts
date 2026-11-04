/**
 * A one-event iCalendar file for «Добавить в календарь». Built in the
 * browser from what the cabinet already has: no API, no third party.
 * The summary names only the practice — a calendar is seen by others.
 */
export function bookingIcs(booking: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  practiceName: string;
  videoUrl: string | null;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Synoro//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.id}@synoro.ru`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(booking.startsAt)}`,
    `DTEND:${stamp(booking.endsAt)}`,
    `SUMMARY:${icsText(`Запись: ${booking.practiceName}`)}`,
    ...(booking.videoUrl
      ? [`LOCATION:${icsText(booking.videoUrl)}`, `URL:${booking.videoUrl}`]
      : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Напоминание о записи",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** Saves the booking as `zapis.ics`; the phone offers to add it. */
export function downloadIcs(booking: Parameters<typeof bookingIcs>[0]) {
  const blob = new Blob([bookingIcs(booking)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "zapis.ics";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 20261105T150000Z */
function stamp(at: Date) {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function icsText(text: string) {
  return text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}

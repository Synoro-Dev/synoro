import { z } from "zod";

/**
 * The canonical IANA name of `value` («europe/moscow» → «Europe/Moscow»), or
 * undefined when the runtime doesn't know the zone.
 */
export function canonicalTimeZone(value: string): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The time zone a client books from, as their browser reports it. It only
 * decides how mails and reminders write the time, so a zone this runtime does
 * not know is dropped (undefined) rather than failing the booking.
 */
export const clientTimeZoneInput = z
  .string()
  .max(64)
  .optional()
  .transform((value) => (value ? canonicalTimeZone(value) : undefined));

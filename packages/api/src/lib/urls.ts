import { env, paths } from "@synoro/config";

/** Where public booking pages live: `BOOKING_URL`, else the app itself. */
function bookingOrigin() {
  return new URL(env.BOOKING_URL ?? env.APP_URL).origin;
}

/** The main address of a practice booking page: `https://synoro.ru/p/anna`. */
export function publicBookingUrl(slug: string) {
  return new URL(paths.booking.public(slug), bookingOrigin()).href;
}

/**
 * Path of a practice's photo, or `null` without one. The `v` query is the
 * stored key's own timestamp, so a new upload busts the long-lived cache.
 * A key starting with `/` is a file the app serves itself (the demo seed's
 * `/demo/klyuev.jpg`) and is used as is.
 */
export function practiceImageUrl(slug: string, key: string | null) {
  if (!key) return null;
  if (key.startsWith("/")) return key;
  const version = /-(\d+)\.jpg$/.exec(key)?.[1] ?? "0";
  return `${paths.booking.avatar(slug)}?v=${version}`;
}

/** A visitor booking page, the link that goes into their email. */
export function guestBookingUrl(token: string) {
  return new URL(paths.booking.guest(token), bookingOrigin()).href;
}

/** The cabinet; signed-out visitors are sent to the code sign-in first. */
export function cabinetUrl() {
  return new URL(paths.booking.mine, bookingOrigin()).href;
}

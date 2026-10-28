import { env, paths } from "@synoro/config";

/** Where public booking pages live: `BOOKING_URL`, else the app itself. */
export function bookingOrigin() {
  return new URL(env.BOOKING_URL ?? env.APP_URL).origin;
}

/** The main address of a practice booking page: `https://synoro.ru/p/anna`. */
export function publicBookingUrl(slug: string) {
  return new URL(paths.booking.public(slug), bookingOrigin()).href;
}

/** A visitor booking page, the link that goes into their email. */
export function guestBookingUrl(token: string) {
  return new URL(paths.booking.guest(token), bookingOrigin()).href;
}

/** The cabinet; signed-out visitors are sent to the code sign-in first. */
export function cabinetUrl() {
  return new URL(paths.booking.mine, bookingOrigin()).href;
}

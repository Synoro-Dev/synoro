import { env, paths } from "@synoro/config";

/**
 * Links that go into mails sent by the worker. `@synoro/api` has the same
 * helpers (`lib/urls.ts`) but depends on this package, not the other way.
 */

/** Where public booking pages live: `BOOKING_URL`, else the app itself. */
function bookingOrigin() {
  return new URL(env.BOOKING_URL ?? env.APP_URL).origin;
}

/** The client's cabinet; signed-out visitors sign in with a code first. */
export function cabinetUrl() {
  return new URL(paths.booking.mine, bookingOrigin()).href;
}

/** The main address of a practice's booking page. */
export function practicePageUrl(slug: string) {
  return new URL(paths.booking.public(slug), bookingOrigin()).href;
}

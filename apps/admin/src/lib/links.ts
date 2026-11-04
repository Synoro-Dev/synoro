import { env } from "@synoro/config";

/** A practice's public booking page, as visitors open it. */
export const bookingPageUrl = (slug: string) =>
  new URL(`/${slug}`, env.BOOKING_URL ?? env.APP_URL).href;

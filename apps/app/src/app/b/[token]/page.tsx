import type { Metadata } from "next";

import { GuestBooking } from "~/components/booking";

// The link carries a secret: keep it out of search results and Referer.
export const metadata: Metadata = {
  title: "Ваша запись",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * A visitor's booking by the secret in their link (`booking.reserve` hands it
 * out): open without signing in — proxy.ts lets `/b/*` through. The token is
 * the only credential, and it is checked by the API.
 */
export default async function GuestBookingPage({
  params,
}: PageProps<"/b/[token]">) {
  const { token } = await params;
  return <GuestBooking token={token} />;
}

import { Skeleton } from "@synoro/ui";
import type { Metadata } from "next";
import { Suspense } from "react";

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
export default function GuestBookingPage({ params }: PageProps<"/b/[token]">) {
  return (
    <Suspense
      fallback={<Skeleton className="mx-auto mt-10 h-96 max-w-lg rounded-xl" />}
    >
      <GuestBookingWithToken params={params} />
    </Suspense>
  );
}

async function GuestBookingWithToken({
  params,
}: Pick<PageProps<"/b/[token]">, "params">) {
  const { token } = await params;
  return <GuestBooking token={token} />;
}

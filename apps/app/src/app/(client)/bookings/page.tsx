import { Skeleton } from "@synoro/ui";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { MyBookings } from "~/components/booking";

// Neutral on purpose: a tab title is seen by whoever is near the screen.
export const metadata: Metadata = { title: "Мои записи · Synoro" };

export default function MyBookingsPage() {
  return (
    <main className="flex flex-col gap-6">
      {/* Times depend on the request (now, viewer's zone): not prerendered. */}
      <Suspense fallback={<MyBookingsSkeleton />}>
        <SignedInBookings />
      </Suspense>
    </main>
  );
}

async function SignedInBookings() {
  await getSession();
  return <MyBookings />;
}

function MyBookingsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

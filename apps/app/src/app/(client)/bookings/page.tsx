import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { MyBookings } from "~/components/booking";

// Neutral on purpose: a tab title is seen by whoever is near the screen.
export const metadata: Metadata = { title: "Мои записи · Synoro" };

export default function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ move?: string | string[] }>;
}) {
  return (
    <main className="flex flex-col gap-6">
      {/* Times depend on the request (now, viewer's zone): not prerendered. */}
      <Suspense fallback={<MyBookingsSkeleton />}>
        <SignedInBookings searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SignedInBookings({
  searchParams,
}: {
  searchParams: Promise<{ move?: string | string[] }>;
}) {
  const session = await getSession();
  // A cookie of a revoked session passes proxy.ts: send to sign-in here, where
  // the messenger's `?move=` is known, so the client lands back on the booking
  // (`homeAfterAuth` checks the id). The layout leaves this redirect to us.
  if (!session?.user) {
    const { move } = await searchParams;
    const login = new URLSearchParams({ to: "bookings" });
    if (typeof move === "string") login.set("move", move);
    redirect(`${paths.auth.login}?${login}` as Route);
  }
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

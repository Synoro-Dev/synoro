import { Skeleton } from "@acme/ui";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { MyBookings } from "~/components/booking";
import { SiteHeader } from "~/components/layout";

export default function MyBookingsPage() {
  return (
    <>
      <SiteHeader title="Мои записи" />
      <div className="flex max-w-3xl flex-col gap-6 p-4 lg:p-6">
        <h1 className="text-2xl font-bold tracking-tight">Мои записи</h1>
        {/* Times depend on the request (now, viewer's zone): not prerendered. */}
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <SignedInBookings />
        </Suspense>
      </div>
    </>
  );
}

async function SignedInBookings() {
  await getSession();
  return <MyBookings />;
}

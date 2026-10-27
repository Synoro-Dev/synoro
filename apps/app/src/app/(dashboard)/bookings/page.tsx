import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { MyBookings } from "~/components/booking";
import { SiteHeader } from "~/components/layout";

export default function MyBookingsPage() {
  return (
    <>
      <SiteHeader title="Мои записи" />
      <main className="flex max-w-4xl flex-col gap-6 p-4 lg:p-6">
        {/* Times depend on the request (now, viewer's zone): not prerendered. */}
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <SignedInBookings />
        </Suspense>
      </main>
    </>
  );
}

async function SignedInBookings() {
  await getSession();
  return <MyBookings />;
}

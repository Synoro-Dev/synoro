import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeList } from "~/components/booking";
import { SiteHeader } from "~/components/layout";

export default function PracticesPage() {
  return (
    <>
      <SiteHeader title="Практики" />
      <main className="flex max-w-4xl flex-col p-4 lg:p-6">
        {/* Reads ?new=1 (search params are request-time data). */}
        <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
          <PracticeList />
        </Suspense>
      </main>
    </>
  );
}

import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeOverview } from "~/components/booking/practice-overview";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PageHeading } from "~/components/booking/states";
import { SiteHeader } from "~/components/layout";

export default function PracticeOverviewPage({
  params,
}: PageProps<"/practices/[practiceId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview params={params} />
    </Suspense>
  );
}

async function Overview({
  params,
}: Pick<PageProps<"/practices/[practiceId]">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <>
      <SiteHeader title="Обзор" />
      <main className="flex min-w-0 flex-col gap-6 p-4 lg:p-6">
        <PageHeading
          title={practice.name}
          description="Записи, свободное время и клиенты на этой неделе"
        />
        <PracticeOverview practice={practice} />
      </main>
    </>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}

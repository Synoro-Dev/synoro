import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { AvailabilityEditor } from "~/components/booking/availability-editor";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { SiteHeader } from "~/components/layout";

export default function PracticeSchedulePage({
  params,
}: PageProps<"/practices/[practiceId]/schedule">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Schedule params={params} />
    </Suspense>
  );
}

async function Schedule({
  params,
}: Pick<PageProps<"/practices/[practiceId]/schedule">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <>
      <SiteHeader
        title="Расписание"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col p-4 lg:p-6">
        <AvailabilityEditor
          practiceId={practice.id}
          timezone={practice.timezone}
        />
      </main>
    </>
  );
}

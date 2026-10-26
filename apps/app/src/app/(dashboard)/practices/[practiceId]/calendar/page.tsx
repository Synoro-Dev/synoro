import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeCalendar } from "~/components/booking/practice-calendar";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { SiteHeader } from "~/components/layout";

export default function PracticeCalendarPage({
  params,
}: PageProps<"/practices/[practiceId]/calendar">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-[640px] rounded-xl" />}>
      <Calendar params={params} />
    </Suspense>
  );
}

async function Calendar({
  params,
}: Pick<PageProps<"/practices/[practiceId]/calendar">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <>
      <SiteHeader
        title="Календарь"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col p-4 lg:p-6">
        <PracticeCalendar
          practiceId={practice.id}
          timezone={practice.timezone}
        />
      </main>
    </>
  );
}

import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";
import { PracticeAnalytics } from "~/components/booking/practice-analytics";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { SiteHeader } from "~/components/layout";

export default function PracticeAnalyticsPage({
  params,
}: PageProps<"/practices/[practiceId]/analytics">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Analytics params={params} />
    </Suspense>
  );
}

async function Analytics({
  params,
}: Pick<PageProps<"/practices/[practiceId]/analytics">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <>
      <SiteHeader
        title="Аналитика"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col p-4 lg:p-6">
        <PracticeAnalytics
          practiceId={practice.id}
          isOwner={practice.membership.role === "owner"}
        />
      </main>
    </>
  );
}

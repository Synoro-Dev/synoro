import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeWaitlist } from "~/components/booking/practice-waitlist";
import { PracticeWindows } from "~/components/booking/practice-windows";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { TermsProvider } from "~/components/booking/terms";
import { SiteHeader } from "~/components/layout";

export default function PracticeWindowsPage({
  params,
}: PageProps<"/practices/[practiceId]/windows">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-[640px] rounded-xl" />}>
      <Windows params={params} />
    </Suspense>
  );
}

async function Windows({
  params,
}: Pick<PageProps<"/practices/[practiceId]/windows">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title="Свободные окна"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-6">
        <PracticeWindows
          practiceId={practice.id}
          practiceName={practice.name}
          timezone={practice.timezone}
          introMinutes={practice.introMinutes}
        />
        <PracticeWaitlist practiceId={practice.id} />
      </main>
    </TermsProvider>
  );
}

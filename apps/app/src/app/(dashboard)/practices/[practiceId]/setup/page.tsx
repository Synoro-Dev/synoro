import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeSetup } from "~/components/booking/practice-setup";
import { loadOwnerPractice } from "~/components/booking/staff-practice";
import { TermsProvider } from "~/components/booking/terms";
import { SiteHeader } from "~/components/layout";

export default function PracticeSetupPage({
  params,
}: PageProps<"/practices/[practiceId]/setup">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Setup params={params} />
    </Suspense>
  );
}

async function Setup({
  params,
}: Pick<PageProps<"/practices/[practiceId]/setup">, "params">) {
  const practice = await loadOwnerPractice((await params).practiceId);
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title="Первая настройка"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col p-4 lg:p-6">
        <PracticeSetup practice={practice} />
      </main>
    </TermsProvider>
  );
}

import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeDomain } from "~/components/booking/practice-domain";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeDomainPage({
  params,
}: PageProps<"/practices/[practiceId]/domain">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Domain params={params} />
    </Suspense>
  );
}

async function Domain({
  params,
}: Pick<PageProps<"/practices/[practiceId]/domain">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Свой домен">
      <PracticeDomain
        practiceId={practice.id}
        bookingUrl={practice.bookingUrl}
        isOwner={practice.membership.role === "owner"}
      />
    </PracticeSettingsShell>
  );
}

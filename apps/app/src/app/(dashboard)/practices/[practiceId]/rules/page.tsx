import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeRules } from "~/components/booking/practice-rules";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeRulesPage({
  params,
}: PageProps<"/practices/[practiceId]/rules">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Rules params={params} />
    </Suspense>
  );
}

async function Rules({
  params,
}: Pick<PageProps<"/practices/[practiceId]/rules">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Правила">
      <PracticeRules
        practiceId={practice.id}
        rules={{
          cancelHours: practice.cancelHours,
          lateCancel: practice.lateCancel,
        }}
        isOwner={practice.membership.role === "owner"}
      />
    </PracticeSettingsShell>
  );
}

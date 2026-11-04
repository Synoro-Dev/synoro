import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeTeam } from "~/components/booking/practice-team";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeTeamPage({
  params,
}: PageProps<"/practices/[practiceId]/team">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Team params={params} />
    </Suspense>
  );
}

async function Team({
  params,
}: Pick<PageProps<"/practices/[practiceId]/team">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Команда">
      <PracticeTeam
        practiceId={practice.id}
        isOwner={practice.membership.role === "owner"}
      />
    </PracticeSettingsShell>
  );
}

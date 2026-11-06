import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeImport } from "~/components/booking/practice-import";
import { loadOwnerPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeImportPage({
  params,
}: PageProps<"/practices/[practiceId]/import">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Import params={params} />
    </Suspense>
  );
}

async function Import({
  params,
}: Pick<PageProps<"/practices/[practiceId]/import">, "params">) {
  const practice = await loadOwnerPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Перенос клиентов">
      <PracticeImport practiceId={practice.id} timezone={practice.timezone} />
    </PracticeSettingsShell>
  );
}

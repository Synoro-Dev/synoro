import { Skeleton } from "@synoro/ui";
import { Frame } from "@synoro/ui/reui/frame";
import { Suspense } from "react";

import { PracticeDocuments } from "~/components/booking/practice-documents";
import { loadOwnerPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeDocumentsPage({
  params,
}: PageProps<"/practices/[practiceId]/documents">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Documents params={params} />
    </Suspense>
  );
}

async function Documents({
  params,
}: Pick<PageProps<"/practices/[practiceId]/documents">, "params">) {
  const practice = await loadOwnerPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Документы">
      <Frame spacing="default" className="max-w-3xl min-w-0">
        <PracticeDocuments practiceId={practice.id} />
      </Frame>
    </PracticeSettingsShell>
  );
}

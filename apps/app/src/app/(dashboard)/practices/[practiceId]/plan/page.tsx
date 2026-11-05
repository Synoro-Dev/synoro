import { Skeleton } from "@synoro/ui";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import { Suspense } from "react";

import { BillingPanel } from "~/components/billing/billing-panel";
import { loadOwnerPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";
import { SettingsFormSkeleton } from "~/components/settings/settings-shell";

export default function PracticePlanPage({
  params,
}: PageProps<"/practices/[practiceId]/plan">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Plan params={params} />
    </Suspense>
  );
}

async function Plan({
  params,
}: Pick<PageProps<"/practices/[practiceId]/plan">, "params">) {
  const practice = await loadOwnerPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Тариф">
      <Frame className="max-w-3xl min-w-0">
        <FramePanel>
          {/* The panel reads `?payment=` after the bank's redirect back. */}
          <Suspense fallback={<SettingsFormSkeleton />}>
            <BillingPanel />
          </Suspense>
        </FramePanel>
      </Frame>
    </PracticeSettingsShell>
  );
}

import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { AvailabilityEditor } from "~/components/booking/availability-editor";
import { ClosedDates } from "~/components/booking/closed-dates";
import { GoogleCalendarSync } from "~/components/booking/google-calendar-sync";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeSchedulePage({
  params,
}: PageProps<"/practices/[practiceId]/schedule">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Schedule params={params} />
    </Suspense>
  );
}

async function Schedule({
  params,
}: Pick<PageProps<"/practices/[practiceId]/schedule">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Рабочие часы">
      <AvailabilityEditor
        practiceId={practice.id}
        timezone={practice.timezone}
        introMinutes={practice.introMinutes}
        isOwner={practice.membership.role === "owner"}
      />
      <ClosedDates practiceId={practice.id} timezone={practice.timezone} />
      <GoogleCalendarSync practiceId={practice.id} />
    </PracticeSettingsShell>
  );
}

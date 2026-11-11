import { Skeleton } from "@synoro/ui";
import { Frame } from "@synoro/ui/reui/frame";
import { Suspense } from "react";

import { PracticeBookingQuestions } from "~/components/booking/practice-booking-questions";
import { loadOwnerPractice } from "~/components/booking/staff-practice";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeQuestionsPage({
  params,
}: PageProps<"/practices/[practiceId]/questions">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Questions params={params} />
    </Suspense>
  );
}

async function Questions({
  params,
}: Pick<PageProps<"/practices/[practiceId]/questions">, "params">) {
  const practice = await loadOwnerPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Анкета">
      <Frame spacing="default" className="max-w-3xl min-w-0">
        <PracticeBookingQuestions practiceId={practice.id} />
      </Frame>
    </PracticeSettingsShell>
  );
}

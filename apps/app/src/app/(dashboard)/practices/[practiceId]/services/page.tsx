import { Skeleton } from "@synoro/ui";
import { Frame } from "@synoro/ui/reui/frame";
import { Suspense } from "react";

import { PracticeServices } from "~/components/booking/practice-services";
import { loadOwnerPractice } from "~/components/booking/staff-practice";
import { TermsProvider } from "~/components/booking/terms";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeServicesPage({
  params,
}: PageProps<"/practices/[practiceId]/services">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Services params={params} />
    </Suspense>
  );
}

async function Services({
  params,
}: Pick<PageProps<"/practices/[practiceId]/services">, "params">) {
  const practice = await loadOwnerPractice((await params).practiceId);
  return (
    <TermsProvider profession={practice.profession}>
      <PracticeSettingsShell practice={practice} title="Услуги">
        <Frame spacing="default" className="max-w-3xl min-w-0">
          <PracticeServices practiceId={practice.id} />
        </Frame>
      </PracticeSettingsShell>
    </TermsProvider>
  );
}

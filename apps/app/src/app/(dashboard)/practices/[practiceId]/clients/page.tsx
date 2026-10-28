import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeClients } from "~/components/booking/practice-clients";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { TermsProvider } from "~/components/booking/terms";
import { SiteHeader } from "~/components/layout";

export default function PracticeClientsPage({
  params,
}: PageProps<"/practices/[practiceId]/clients">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Clients params={params} />
    </Suspense>
  );
}

async function Clients({
  params,
}: Pick<PageProps<"/practices/[practiceId]/clients">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title="Клиенты"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col p-4 lg:p-6">
        <PracticeClients
          practiceId={practice.id}
          isOwner={practice.membership.role === "owner"}
        />
      </main>
    </TermsProvider>
  );
}

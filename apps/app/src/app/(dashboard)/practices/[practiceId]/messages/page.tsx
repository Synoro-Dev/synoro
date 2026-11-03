import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";
import { PracticeNotifications } from "~/components/booking/practice-notifications";
import { PracticeWorkflows } from "~/components/booking/practice-workflows";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { TermsProvider } from "~/components/booking/terms";
import { SiteHeader } from "~/components/layout";

export default function PracticeMessagesPage({
  params,
}: PageProps<"/practices/[practiceId]/messages">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Messages params={params} />
    </Suspense>
  );
}

async function Messages({
  params,
}: Pick<PageProps<"/practices/[practiceId]/messages">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  const isOwner = practice.membership.role === "owner";
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title="Сообщения"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 max-w-3xl flex-col gap-6 p-4 lg:p-6">
        {isOwner ? (
          <PracticeNotifications
            practiceId={practice.id}
            initial={{
              remindClients: practice.remindClients,
              notifyStaff: practice.notifyStaff,
              dailyAgenda: practice.dailyAgenda,
            }}
          />
        ) : null}
        <PracticeWorkflows
          practiceId={practice.id}
          practiceName={practice.name}
          bookingUrl={practice.bookingUrl}
          isOwner={isOwner}
        />
      </main>
    </TermsProvider>
  );
}

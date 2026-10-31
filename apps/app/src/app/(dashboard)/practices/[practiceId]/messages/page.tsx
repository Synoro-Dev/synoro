import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";
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
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title="Сообщения"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col p-4 lg:p-6">
        <PracticeWorkflows
          practiceId={practice.id}
          practiceName={practice.name}
          bookingUrl={practice.bookingUrl}
          isOwner={practice.membership.role === "owner"}
        />
      </main>
    </TermsProvider>
  );
}

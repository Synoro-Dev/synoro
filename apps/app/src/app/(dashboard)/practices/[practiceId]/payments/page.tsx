import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { loadStaffPractice } from "~/components/booking/staff-practice";
import { SiteHeader } from "~/components/layout";
import { PracticePayments } from "~/components/payment/practice-payments";

export default function PracticePaymentsPage({
  params,
}: PageProps<"/practices/[practiceId]/payments">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Payments params={params} />
    </Suspense>
  );
}

async function Payments({
  params,
}: Pick<PageProps<"/practices/[practiceId]/payments">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <>
      <SiteHeader
        title="Оплата"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col p-4 lg:p-6">
        <PracticePayments
          practiceId={practice.id}
          isOwner={practice.membership.role === "owner"}
        />
      </main>
    </>
  );
}

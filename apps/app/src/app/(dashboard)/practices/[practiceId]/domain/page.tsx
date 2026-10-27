import { paths } from "@acme/config";
import { Skeleton } from "@acme/ui";
import { Suspense } from "react";

import { PracticeDomain } from "~/components/booking/practice-domain";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { SiteHeader } from "~/components/layout";

export default function PracticeDomainPage({
  params,
}: PageProps<"/practices/[practiceId]/domain">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Domain params={params} />
    </Suspense>
  );
}

async function Domain({
  params,
}: Pick<PageProps<"/practices/[practiceId]/domain">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <>
      <SiteHeader
        title="Домен"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col p-4 lg:p-6">
        <PracticeDomain
          practiceId={practice.id}
          slug={practice.slug}
          isOwner={practice.membership.role === "owner"}
        />
      </main>
    </>
  );
}

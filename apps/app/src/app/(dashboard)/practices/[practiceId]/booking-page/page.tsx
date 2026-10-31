import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeBookingPage } from "~/components/booking/practice-booking-page";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PageHeading } from "~/components/booking/states";
import { TermsProvider } from "~/components/booking/terms";
import { SiteHeader } from "~/components/layout";

export default function PracticeBookingPagePage({
  params,
}: PageProps<"/practices/[practiceId]/booking-page">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <BookingPage params={params} />
    </Suspense>
  );
}

async function BookingPage({
  params,
}: Pick<PageProps<"/practices/[practiceId]/booking-page">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title="Страница записи"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex min-w-0 flex-col gap-6 p-4 lg:p-6">
        <PageHeading
          title="Страница записи"
          description="Фото, ссылка и видеовстреча — то, что видят ваши клиенты"
        />
        <PracticeBookingPage practice={practice} />
      </main>
    </TermsProvider>
  );
}

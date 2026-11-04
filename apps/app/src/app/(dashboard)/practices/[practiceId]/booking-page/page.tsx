import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { PracticeBookingPage } from "~/components/booking/practice-booking-page";
import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PageHeading } from "~/components/booking/states";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

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
    <PracticeSettingsShell practice={practice} title="Страница записи">
      <PageHeading
        title="Страница записи"
        description="Фото, оформление, ссылка и видеовстреча — то, что видят ваши клиенты"
      />
      <PracticeBookingPage practice={practice} />
    </PracticeSettingsShell>
  );
}

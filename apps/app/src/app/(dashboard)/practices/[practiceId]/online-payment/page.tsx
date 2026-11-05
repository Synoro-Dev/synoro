import { Skeleton } from "@synoro/ui";
import { Suspense } from "react";

import { loadOwnerPractice } from "~/components/booking/staff-practice";
import { PracticeOnlinePayment } from "~/components/payment/practice-payments";
import { PracticeSettingsShell } from "~/components/settings/practice-settings-shell";

export default function PracticeOnlinePaymentPage({
  params,
}: PageProps<"/practices/[practiceId]/online-payment">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <OnlinePayment params={params} />
    </Suspense>
  );
}

async function OnlinePayment({
  params,
}: Pick<PageProps<"/practices/[practiceId]/online-payment">, "params">) {
  const practice = await loadOwnerPractice((await params).practiceId);
  return (
    <PracticeSettingsShell practice={practice} title="Онлайн-оплата">
      <PracticeOnlinePayment practiceId={practice.id} />
    </PracticeSettingsShell>
  );
}

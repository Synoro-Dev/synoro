import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { api } from "~/orpc/server";

/**
 * Home: specialists and administrators land in their first practice,
 * clients in their bookings, newcomers on the practices page.
 *
 * `?plan=pro` (sign-up from the landing's «Про» buttons) goes to «Про»
 * instead: billing for a practice owner, practice creation for everyone
 * else — the trial starts with the first practice.
 */
export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-64 rounded-xl" />}>
      <RedirectHome searchParams={searchParams} />
    </Suspense>
  );
}

async function RedirectHome({
  searchParams,
}: Pick<PageProps<"/">, "searchParams">): Promise<null> {
  const [practices, { plan }] = await Promise.all([
    api.practice.mine(),
    searchParams,
  ]);

  if (plan === "pro") {
    if (practices.some((p) => p.role === "owner")) {
      redirect(paths.settings.billing);
    }
    redirect(`${paths.booking.practices}?new=1&plan=pro`);
  }

  const staff = practices.find((p) => p.role !== "client");

  if (staff) redirect(paths.booking.practice(staff.practiceId));
  if (practices.length > 0) redirect(paths.booking.mine);
  redirect(paths.booking.practices);
}

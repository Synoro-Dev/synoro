import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { api } from "~/orpc/server";

/**
 * Home: specialists and administrators land in their first practice,
 * clients in their bookings, newcomers on the practices page.
 */
export default function HomePage() {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-64 rounded-xl" />}>
      <RedirectHome />
    </Suspense>
  );
}

async function RedirectHome(): Promise<null> {
  const practices = await api.practice.mine();
  const staff = practices.find((p) => p.role !== "client");

  if (staff) redirect(paths.booking.practice(staff.practiceId));
  if (practices.length > 0) redirect(paths.booking.mine);
  redirect(paths.booking.practices);
}

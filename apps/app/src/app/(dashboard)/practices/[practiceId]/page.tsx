import { paths } from "@acme/config";
import { Skeleton } from "@acme/ui";
import { ORPCError } from "@orpc/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { PracticeWorkspace } from "~/components/booking";
import { SiteHeader } from "~/components/layout";
import { api } from "~/orpc/server";

export default function PracticePage({
  params,
}: PageProps<"/practices/[practiceId]">) {
  return (
    <>
      <SiteHeader title="Практика" />
      {/* Params and membership are request-time data: stream them in. */}
      <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
        <PracticeWithData params={params} />
      </Suspense>
    </>
  );
}

async function PracticeWithData({
  params,
}: Pick<PageProps<"/practices/[practiceId]">, "params">) {
  const { practiceId } = await params;
  const practice = await api.practice
    .get({ practiceId })
    .catch((error: unknown) => {
      // Not a member (FORBIDDEN) or not a uuid (BAD_REQUEST): no such page.
      if (
        error instanceof ORPCError &&
        (error.code === "FORBIDDEN" || error.code === "BAD_REQUEST")
      ) {
        notFound();
      }
      throw error;
    });

  // Clients don't run the practice: send them to the booking page.
  if (practice.membership.role === "client") {
    redirect(paths.booking.public(practice.slug));
  }

  return <PracticeWorkspace practice={practice} />;
}

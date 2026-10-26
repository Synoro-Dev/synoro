import { Skeleton } from "@acme/ui";
import { isDefinedError } from "@orpc/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { PublicBooking } from "~/components/booking";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Запись на консультацию" };

/**
 * Public booking page of a practice. Open without signing in (proxy.ts lets
 * `/p/*` through); booking itself needs an account and paid consultations.
 */
export default function PublicBookingPage({ params }: PageProps<"/p/[slug]">) {
  return (
    <Suspense
      fallback={
        <Skeleton className="mx-auto mt-10 h-96 max-w-5xl rounded-xl" />
      }
    >
      <PublicBookingWithData params={params} />
    </Suspense>
  );
}

async function PublicBookingWithData({
  params,
}: Pick<PageProps<"/p/[slug]">, "params">) {
  const { slug } = await params;
  const [practice, session] = await Promise.all([
    api.practice.bySlug({ slug }).catch((error: unknown) => {
      if (isDefinedError(error)) notFound();
      throw error;
    }),
    getSession(),
  ]);

  return <PublicBooking practice={practice} signedIn={!!session?.user} />;
}

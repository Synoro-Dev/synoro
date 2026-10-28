import { isDefinedError } from "@orpc/server";
import { Skeleton } from "@synoro/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { PublicBooking } from "~/components/booking";
import { bookingUrl } from "~/lib/hosts";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Онлайн-запись" };

/**
 * Public booking page of a practice, the main address `synoro.ru/p/<slug>`
 * (proxy.ts sends the app host there). Open without signing in: a visitor
 * books with name, phone and email and pays online; a signed-in client books
 * from their balance.
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

  return (
    <>
      <link rel="canonical" href={bookingUrl(practice.slug)} />
      <PublicBooking practice={practice} signedIn={!!session?.user} />
    </>
  );
}

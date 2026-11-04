import { isDefinedError } from "@orpc/server";
import { Skeleton } from "@synoro/ui";
import { isPracticeSlug } from "@synoro/validators";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { PublicBooking } from "~/components/booking";
import { bookingUrl } from "~/lib/hosts";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Онлайн-запись" };

/**
 * Public booking page of a practice, the main address `synoro.ru/<slug>`
 * (proxy.ts sends the app host there; the old `/p/<slug>` redirects). Open
 * without signing in: a visitor books with name, phone and email and pays
 * online; a signed-in client books from their balance.
 *
 * The app's own top-level routes are static segments and win over `[slug]`;
 * `RESERVED_SLUGS` keeps a practice from taking one of those names.
 */
export default function PublicBookingPage({ params }: PageProps<"/[slug]">) {
  return (
    <Suspense
      fallback={
        <Skeleton className="mx-auto mt-10 h-[32rem] max-w-4xl rounded-2xl" />
      }
    >
      <PublicBookingWithData params={params} />
    </Suspense>
  );
}

async function PublicBookingWithData({
  params,
}: Pick<PageProps<"/[slug]">, "params">) {
  const { slug } = await params;
  // Names that cannot be a slug (/robots.txt, /favicon.ico) skip the database.
  if (!isPracticeSlug(slug.toLowerCase())) notFound();
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

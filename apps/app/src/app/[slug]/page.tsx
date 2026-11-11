import { isDefinedError } from "@orpc/server";
import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { isPracticeSlug } from "@synoro/validators";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { getSession } from "~/auth/server";
import { PublicBooking } from "~/components/booking";
import { bookingUrl } from "~/lib/hosts";
import { practiceMetadata } from "~/lib/page-metadata";
import { api } from "~/orpc/server";

/** One lookup per request: the metadata and the page both need it. */
const practiceBySlug = cache((slug: string) =>
  api.practice.bySlug({ slug }).catch((error: unknown) => {
    if (isDefinedError(error)) notFound();
    throw error;
  }),
);

export async function generateMetadata({
  params,
}: PageProps<"/[slug]">): Promise<Metadata> {
  const slug = (await params).slug.toLowerCase();
  if (!isPracticeSlug(slug)) notFound();
  await connection();
  const practice = await practiceBySlug(slug);
  return practiceMetadata(practice.name, bookingUrl(practice.slug));
}

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
  const slug = (await params).slug.toLowerCase();
  // Names that cannot be a slug (/robots.txt, /favicon.ico) skip the database.
  if (!isPracticeSlug(slug)) notFound();
  // At request time: nothing below can be prerendered, including the tracing
  // span around the API call.
  await connection();
  const [practice, session] = await Promise.all([
    practiceBySlug(slug),
    getSession(),
  ]);
  // A former address: clients' old links lead to the current one.
  if (practice.slug !== slug) {
    redirect(paths.booking.public(practice.slug));
  }

  const offer = await api.payment.packages({ practiceId: practice.id });

  return (
    <PublicBooking
      practice={practice}
      offer={offer}
      signedIn={!!session?.user}
    />
  );
}

import { isDefinedError } from "@orpc/server";
import { Skeleton } from "@synoro/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";

import { getSession } from "~/auth/server";
import { PublicBooking } from "~/components/booking";
import { bookingUrl } from "~/lib/hosts";
import { practiceMetadata } from "~/lib/page-metadata";
import { api } from "~/orpc/server";

/** One lookup per request: the metadata and the page both need it. */
const practiceByHost = cache((host: string) =>
  api.practice.byHost({ host }).catch((error: unknown) => {
    if (isDefinedError(error)) notFound();
    throw error;
  }),
);

/** The specialist's own domain is the address of this page, not synoro.ru. */
export async function generateMetadata({
  params,
}: PageProps<"/site/[host]">): Promise<Metadata> {
  await connection();
  const { host } = await params;
  const practice = await practiceByHost(host);
  return practiceMetadata(practice.name, `https://${host}/`);
}

/**
 * The booking page on a practice's own host (`anna.<root>`, `anna-ivanova.ru`):
 * proxy.ts rewrites `/` there to `/site/<host>`. Sign-in and booking happen
 * on the app host, where the session cookie is.
 */
export default function PracticeSitePage({
  params,
}: PageProps<"/site/[host]">) {
  return (
    <Suspense
      fallback={
        <Skeleton className="mx-auto mt-10 h-[32rem] max-w-4xl rounded-2xl" />
      }
    >
      <PracticeSiteWithData params={params} />
    </Suspense>
  );
}

async function PracticeSiteWithData({
  params,
}: Pick<PageProps<"/site/[host]">, "params">) {
  // The host only exists at request time (proxy.ts rewrite): nothing here
  // can be prerendered, including the tracing span around the API call.
  await connection();
  const { host } = await params;
  const [practice, session] = await Promise.all([
    practiceByHost(host),
    getSession(),
  ]);

  const offer = await api.payment.packages({ practiceId: practice.id });

  return (
    <PublicBooking
      practice={practice}
      offer={offer}
      signedIn={!!session?.user}
      bookingUrl={bookingUrl(practice.slug)}
    />
  );
}

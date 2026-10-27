import { paths } from "@acme/config";
import { Skeleton } from "@acme/ui";
import { isDefinedError } from "@orpc/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { PublicBooking } from "~/components/booking";
import { appUrl } from "~/lib/hosts";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Запись на консультацию" };

/**
 * The booking page on a practice's own host (`anna.<root>`, `anna-psy.ru`):
 * proxy.ts rewrites `/` there to `/site/<host>`. Sign-in and booking happen
 * on the app host, where the session cookie is.
 */
export default function PracticeSitePage({
  params,
}: PageProps<"/site/[host]">) {
  return (
    <Suspense
      fallback={
        <Skeleton className="mx-auto mt-10 h-96 max-w-5xl rounded-xl" />
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
    api.practice.byHost({ host }).catch((error: unknown) => {
      if (isDefinedError(error)) notFound();
      throw error;
    }),
    getSession(),
  ]);

  return (
    <PublicBooking
      practice={practice}
      signedIn={!!session?.user}
      bookingUrl={new URL(paths.booking.public(practice.slug), appUrl).href}
    />
  );
}

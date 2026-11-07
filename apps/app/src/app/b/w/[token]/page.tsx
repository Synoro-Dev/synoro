import { Skeleton } from "@synoro/ui";
import type { Metadata } from "next";
import { Suspense } from "react";

import { WaitlistConfirm } from "~/components/booking";

// The link carries a secret: keep it out of search results and Referer.
export const metadata: Metadata = {
  title: "Лист ожидания",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Confirms a visitor's waiting-list wish by the secret in the mailed link
 * (`waitlist.join` sends it): open without signing in — proxy.ts lets `/b/*`
 * through. The token is the only credential, and the API checks it.
 */
export default function WaitlistConfirmPage({
  params,
}: PageProps<"/b/w/[token]">) {
  return (
    <Suspense
      fallback={<Skeleton className="mx-auto mt-10 h-72 max-w-lg rounded-xl" />}
    >
      <WaitlistConfirmWithToken params={params} />
    </Suspense>
  );
}

async function WaitlistConfirmWithToken({
  params,
}: Pick<PageProps<"/b/w/[token]">, "params">) {
  const { token } = await params;
  return <WaitlistConfirm token={token} />;
}

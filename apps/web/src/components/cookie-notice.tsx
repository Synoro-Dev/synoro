"use client";

import { legal } from "@synoro/config";
import { CookieBanner } from "@synoro/ui";
import { stopYandexMetrika } from "@synoro/ui/cookie-consent";

/** Analytics banner of the landing; refusing stops the Metrika counter. */
export function CookieNotice({ counterId }: { counterId: number }) {
  return (
    <CookieBanner
      policyHref={legal.docs.cookies.path}
      sharedDomain={new URL(legal.siteUrl).hostname}
      onChange={(value) => {
        if (value === "declined") stopYandexMetrika(counterId);
      }}
    />
  );
}

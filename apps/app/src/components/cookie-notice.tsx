"use client";

import { legal, legalUrl } from "@synoro/config";
import { CookieBanner } from "@synoro/ui";
import { stopYandexMetrika } from "@synoro/ui/cookie-consent";

import { COUNTER_ID } from "~/components/yandex-metrika";

/** Analytics banner of the app; refusing stops the Metrika counter. */
export function CookieNotice() {
  // Same production-only rule as the counter itself.
  if (process.env.NODE_ENV !== "production") return null;
  return (
    <CookieBanner
      policyHref={legalUrl("cookies")}
      sharedDomain={new URL(legal.siteUrl).hostname}
      onChange={(value) => {
        if (value === "declined") stopYandexMetrika(COUNTER_ID);
      }}
    />
  );
}

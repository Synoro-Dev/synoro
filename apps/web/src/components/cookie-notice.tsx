"use client";

import { legal } from "@synoro/config";
import { CookieBanner } from "@synoro/ui";
import { clearCookies, stopYandexMetrika } from "@synoro/ui/cookie-consent";

import { YCLID_COOKIE } from "./ad-click";

/**
 * Analytics banner of the landing; refusing stops the Metrika counter and
 * forgets the remembered ad click.
 */
export function CookieNotice({ counterId }: { counterId: number }) {
  return (
    <CookieBanner
      policyHref={legal.docs.cookies.path}
      sharedDomain={new URL(legal.siteUrl).hostname}
      onChange={(value) => {
        if (value !== "declined") return;
        stopYandexMetrika(counterId);
        clearCookies(YCLID_COOKIE);
      }}
    />
  );
}

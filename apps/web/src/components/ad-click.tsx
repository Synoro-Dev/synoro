"use client";

import { legal } from "@synoro/config";
import { readConsent } from "@synoro/ui/cookie-consent";
import { useEffect } from "react";

/**
 * Read by `adAttribution` in `@synoro/api` (billing/attribution.ts): keep the
 * two names in sync.
 */
export const YCLID_COOKIE = "ad_yclid";

const DAYS = 90;

/**
 * Remembers the Yandex Direct click (`?yclid=` in the ad's link) for 90 days
 * in a cookie shared with the app, so a payment made weeks later in the app
 * can be tied back to the ad (docs/direct.md). Off once the visitor declined
 * analytics in the cookie banner.
 */
export function AdClick() {
  useEffect(() => {
    const yclid = new URLSearchParams(location.search).get("yclid");
    if (!yclid || !/^[0-9A-Za-z_-]{1,64}$/.test(yclid)) return;
    if (readConsent() === "declined") return;

    const shared = new URL(legal.siteUrl).hostname;
    const domain =
      location.hostname === shared || location.hostname.endsWith(`.${shared}`)
        ? `; domain=.${shared}`
        : "";
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${YCLID_COOKIE}=${yclid}; max-age=${DAYS * 24 * 60 * 60}; path=/; samesite=lax${domain}${secure}`;
  }, []);

  return null;
}

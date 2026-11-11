"use client";

import { legal } from "@synoro/config";
import { readConsent } from "@synoro/ui/cookie-consent";
import { useEffect } from "react";

/**
 * Read by `adAttribution` in `@synoro/api` (billing/attribution.ts) and, with
 * `VISIT_COOKIE`, by `readVisitSource` in `@synoro/auth` (visit-source.ts):
 * keep the names and the format in sync.
 */
export const YCLID_COOKIE = "ad_yclid";
export const VISIT_COOKIE = "ad_visit";

const DAYS = 90;
const MAX_FIELD = 120;

/** `?utm_*` of the link → the short keys `readVisitSource` reads. */
const UTM_KEYS = {
  utm_source: "us",
  utm_medium: "um",
  utm_campaign: "uc",
  utm_content: "uu",
  utm_term: "ut",
} as const;

function cookieAttributes() {
  const shared = new URL(legal.siteUrl).hostname;
  const domain =
    location.hostname === shared || location.hostname.endsWith(`.${shared}`)
      ? `; domain=.${shared}`
      : "";
  const secure = location.protocol === "https:" ? "; secure" : "";
  return `; max-age=${DAYS * 24 * 60 * 60}; path=/; samesite=lax${domain}${secure}`;
}

function hasCookie(name: string) {
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(`${name}=`));
}

/** The site that sent the visitor, unless it is one of ours. */
function externalReferrerHost() {
  if (!document.referrer) return null;
  try {
    const host = new URL(document.referrer).hostname.toLowerCase();
    const shared = new URL(legal.siteUrl).hostname;
    if (!host || host === location.hostname) return null;
    if (host === shared || host.endsWith(`.${shared}`)) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Remembers where the visitor came from for 90 days in cookies shared with
 * the app, so a sign-in or payment made weeks later can be tied back:
 *
 * - the Yandex Direct click (`?yclid=`) in `ad_yclid` (docs/direct.md);
 * - `ad_visit` with the UTM tags, the referring site and the first page
 *   (docs/sign-in-history.md). A visit with UTM tags or a `yclid` is an ad and
 *   always replaces it; any other keeps the first referring site, and a
 *   direct visit (no referrer) leaves nothing.
 *
 * Off once the visitor declined analytics in the cookie banner.
 */
export function AdClick() {
  useEffect(() => {
    if (readConsent() === "declined") return;

    const query = new URLSearchParams(location.search);
    const attributes = cookieAttributes();

    const yclid = query.get("yclid");
    const hasYclid = !!yclid && /^[0-9A-Za-z_-]{1,64}$/.test(yclid);
    if (hasYclid) {
      document.cookie = `${YCLID_COOKIE}=${yclid}${attributes}`;
      // Metrika matches a click for 21 days only: keep when it happened.
      document.cookie = `${YCLID_COOKIE}_at=${Math.floor(Date.now() / 1000)}${attributes}`;
    }

    const visit = new URLSearchParams();
    for (const [param, key] of Object.entries(UTM_KEYS)) {
      const value = query.get(param)?.trim();
      if (value) visit.set(key, value.slice(0, MAX_FIELD));
    }
    const isAd = hasYclid || visit.size > 0;
    const referrer = isAd ? null : externalReferrerHost();
    if (referrer) visit.set("ref", referrer);

    // A direct visit, or a second referral after the first one, changes nothing.
    if (!isAd && (visit.size === 0 || hasCookie(VISIT_COOKIE))) return;
    visit.set("lp", location.pathname.slice(0, MAX_FIELD));
    document.cookie = `${VISIT_COOKIE}=${encodeURIComponent(visit.toString())}${attributes}`;
  }, []);

  return null;
}

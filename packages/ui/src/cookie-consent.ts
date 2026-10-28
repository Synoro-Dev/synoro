/**
 * The visitor's analytics choice, kept in a first-party cookie so the landing
 * (synoro.ru) and the app (app.synoro.ru) share it. No `"use client"`: server
 * components read `CONSENT_COOKIE` too (the Metrika snippets check it before
 * loading the counter).
 *
 * Opt-out model: no cookie means analytics runs and the banner is shown;
 * "declined" stops the counter and keeps it off on later visits.
 */

export const CONSENT_COOKIE = "cookie_consent";

export type CookieConsent = "accepted" | "declined";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function readConsent(): CookieConsent | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=(accepted|declined)`),
  );
  return match?.[1] as CookieConsent | undefined;
}

/** The domain to share the cookie on, when the page is served under it. */
function sharedCookieDomain(sharedDomain: string | undefined) {
  if (!sharedDomain) return "";
  const host = location.hostname;
  return host === sharedDomain || host.endsWith(`.${sharedDomain}`)
    ? `; domain=.${sharedDomain}`
    : "";
}

export function writeConsent(value: CookieConsent, sharedDomain?: string) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; max-age=${YEAR_SECONDS}; path=/; samesite=lax${sharedCookieDomain(sharedDomain)}${secure}`;
}

/** Remove cookies whose name starts with `prefix` (host-only and parent domain). */
export function clearCookies(prefix: string) {
  const parts = location.hostname.split(".");
  const domains = ["", ...parts.map((_, i) => `; domain=${parts.slice(i).join(".")}`)];
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim();
    if (!name?.startsWith(prefix)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; max-age=0; path=/${domain}`;
    }
  }
}

/** Stop a running Yandex Metrika counter and drop its cookies. */
export function stopYandexMetrika(counterId: number) {
  const ym = (window as { ym?: (id: number, method: string) => void }).ym;
  ym?.(counterId, "destruct");
  clearCookies("_ym");
}

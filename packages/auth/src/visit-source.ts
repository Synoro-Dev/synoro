/**
 * Where a visitor came from, read off the request's cookies when they sign
 * in (docs/sign-in-history.md). The landing writes both cookies on
 * `.synoro.ru` (`apps/web/src/components/ad-click.tsx`): keep the names and
 * the format in sync with it.
 *
 * - `ad_yclid` / `ad_yclid_at` — the Yandex Direct click and when it happened
 *   (also read by `adAttribution` in `@synoro/api` for payments);
 * - `ad_visit` — a query string with the UTM tags (`us`, `um`, `uc`, `uu`,
 *   `ut`), the referring site's host (`ref`) and the first page (`lp`).
 */

const YCLID_COOKIE = "ad_yclid";
const YCLID_AT_COOKIE = "ad_yclid_at";
const VISIT_COOKIE = "ad_visit";

const MAX_FIELD = 120;

export interface VisitSource {
  yclid: string | null;
  /** When the click happened; null if the landing did not record it. */
  yclidAt: Date | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  /** The site that sent the visitor; null for ads and direct visits. */
  referrerHost: string | null;
  landingPath: string | null;
}

export const NO_VISIT_SOURCE: VisitSource = {
  yclid: null,
  yclidAt: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  referrerHost: null,
  landingPath: null,
};

function cookieValue(header: string, name: string) {
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1 || part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Cookies are user input: printable text only, and not too long. */
function text(value: string | null | undefined) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips them
  const clean = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean ? clean.slice(0, MAX_FIELD) : null;
}

function hostOf(value: string | null) {
  return value && /^[a-z0-9.-]{1,100}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function pathOf(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export function readVisitSource(
  headers: Headers | null | undefined,
  now = new Date(),
): VisitSource {
  const header = headers?.get("cookie");
  if (!header) return NO_VISIT_SOURCE;
  // A visitor who declined analytics (CONSENT_COOKIE in @synoro/ui, shared
  // across .synoro.ru) is not tracked, whatever cookies are left over.
  if (cookieValue(header, "cookie_consent") === "declined") {
    return NO_VISIT_SOURCE;
  }

  const yclidRaw = cookieValue(header, YCLID_COOKIE);
  const yclid =
    yclidRaw && /^[0-9A-Za-z_-]{1,64}$/.test(yclidRaw) ? yclidRaw : null;
  const clickedAt = cookieValue(header, YCLID_AT_COOKIE);
  // Seconds since the epoch, never in the future.
  const seconds = clickedAt && /^\d{1,10}$/.test(clickedAt) ? +clickedAt : 0;

  const visit = new URLSearchParams(
    safeDecode(cookieValue(header, VISIT_COOKIE) ?? ""),
  );

  return {
    yclid,
    yclidAt:
      yclid && seconds > 0 && seconds * 1000 <= now.getTime()
        ? new Date(seconds * 1000)
        : null,
    utmSource: text(visit.get("us")),
    utmMedium: text(visit.get("um")),
    utmCampaign: text(visit.get("uc")),
    utmContent: text(visit.get("uu")),
    utmTerm: text(visit.get("ut")),
    referrerHost: hostOf(text(visit.get("ref"))),
    landingPath: pathOf(text(visit.get("lp"))),
  };
}

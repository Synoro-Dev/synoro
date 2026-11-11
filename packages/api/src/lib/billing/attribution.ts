/**
 * Where a paying specialist came from, read off the request's cookies
 * (docs/direct.md). Both cookies are set on `.synoro.ru`, so the landing's
 * visit reaches the app: `ad_yclid` is the Yandex Direct click remembered by
 * the landing, `_ym_uid` the visitor id of Yandex Metrika.
 */

const YCLID_COOKIE = "ad_yclid";
const METRIKA_UID_COOKIE = "_ym_uid";

const YCLID_AT_COOKIE = "ad_yclid_at";

export interface AdAttribution {
  yclid: string | null;
  /** When the click happened; null if the landing did not record it. */
  yclidAt: Date | null;
  ymClientId: string | null;
}

function cookieValue(header: string, name: string) {
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1 || part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Cookies are user input: keep only values shaped like the real ids. */
export function adAttribution(
  headers: Headers,
  now = new Date(),
): AdAttribution {
  const header = headers.get("cookie") ?? "";
  const yclid = cookieValue(header, YCLID_COOKIE);
  const clickedAt = cookieValue(header, YCLID_AT_COOKIE);
  const ymClientId = cookieValue(header, METRIKA_UID_COOKIE);
  const valid = !!yclid && /^[0-9A-Za-z_-]{1,64}$/.test(yclid);
  // Seconds since the epoch, never in the future.
  const seconds = clickedAt && /^\d{1,10}$/.test(clickedAt) ? +clickedAt : 0;
  return {
    yclid: valid ? yclid : null,
    yclidAt:
      valid && seconds > 0 && seconds * 1000 <= now.getTime()
        ? new Date(seconds * 1000)
        : null,
    ymClientId: ymClientId && /^\d{1,32}$/.test(ymClientId) ? ymClientId : null,
  };
}

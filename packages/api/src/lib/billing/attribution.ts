/**
 * Where a paying specialist came from, read off the request's cookies
 * (docs/direct.md). Both cookies are set on `.synoro.ru`, so the landing's
 * visit reaches the app: `ad_yclid` is the Yandex Direct click remembered by
 * the landing, `_ym_uid` the visitor id of Yandex Metrika.
 */

const YCLID_COOKIE = "ad_yclid";
const METRIKA_UID_COOKIE = "_ym_uid";

export interface AdAttribution {
  yclid: string | null;
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
export function adAttribution(headers: Headers): AdAttribution {
  const header = headers.get("cookie") ?? "";
  const yclid = cookieValue(header, YCLID_COOKIE);
  const ymClientId = cookieValue(header, METRIKA_UID_COOKIE);
  return {
    yclid: yclid && /^[0-9A-Za-z_-]{1,64}$/.test(yclid) ? yclid : null,
    ymClientId: ymClientId && /^\d{1,32}$/.test(ymClientId) ? ymClientId : null,
  };
}

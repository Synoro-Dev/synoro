import { isIP } from "node:net";

import { env, logger } from "@synoro/config";

export interface Geo {
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  region: string | null;
  city: string | null;
}

/** Where an IP address is; null when unknown. Never throws. */
export type GeoLookup = (ip: string) => Promise<Geo | null>;

const TIMEOUT_MS = 3000;

function ipv4Octets(ip: string) {
  const octets = ip.split(".").map(Number);
  return octets.length === 4 ? octets : null;
}

function isPublicV4(ip: string) {
  const octets = ipv4Octets(ip);
  if (!octets) return false;
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  // Carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/**
 * The eight 16-bit groups of an IPv6 address, whatever its spelling (`::1`,
 * `0:0:0:0:0:0:0:1`, `::ffff:7f00:1`, `::ffff:127.0.0.1`); null if it is not
 * one (or carries a zone id).
 */
function ipv6Groups(ip: string): number[] | null {
  if (ip.includes("%") || isIP(ip) !== 6) return null;
  let text = ip.toLowerCase();
  // A dotted IPv4 tail stands for the last two groups.
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted?.[1]) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted[1].split(".").map(Number);
    text = `${text.slice(0, -dotted[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail, ...rest] = text.split("::");
  if (rest.length > 0) return null;
  const parse = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((group) => Number.parseInt(group, 16));
  const first = parse(head);
  const last = tail === undefined ? [] : parse(tail);
  const missing = 8 - first.length - last.length;
  if (tail === undefined ? missing !== 0 : missing < 0) return null;
  const groups = [
    ...first,
    ...Array<number>(tail === undefined ? 0 : missing).fill(0),
    ...last,
  ];
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

const v4Of = (high: number, low: number) =>
  `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

/**
 * Whether a geo service can say anything about the address: not a private,
 * loopback or link-local one (a dev machine, or a proxy that hides the
 * client's IP), and never sent to a third party. IPv6 is judged by the
 * address, not its spelling.
 */
export function isPublicIp(ip: string) {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups;
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d) and
  // NAT64 (64:ff9b::a.b.c.d) take the IPv4 verdict, :: and ::1 included.
  const zeros = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zeros && (g5 === 0xffff || g5 === 0)) return isPublicV4(v4Of(g6, g7));
  if (
    g0 === 0x64 &&
    g1 === 0xff9b &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0
  ) {
    return isPublicV4(v4Of(g6, g7));
  }
  // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local,
  // ff00::/8 multicast, 2001:db8::/32 documentation.
  if ((g0 & 0xfe00) === 0xfc00) return false;
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return false;
  if (g0 >> 8 === 0xff) return false;
  if (g0 === 0x2001 && g1 === 0xdb8) return false;
  return true;
}

const str = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : null;

/**
 * Reads the answer of ipwho.is (`country_code`, `region`, `city`), ip-api.com
 * (`countryCode`, `regionName`) or ipapi.co (`country_code`, `region`): any
 * of them can stand behind `GEOIP_URL`.
 */
export function parseGeo(body: unknown): Geo | null {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  if (data.success === false || data.error || data.status === "fail") {
    return null;
  }
  const country = str(data.country_code ?? data.countryCode)?.toUpperCase();
  const geo: Geo = {
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    region: str(data.region ?? data.regionName),
    city: str(data.city),
  };
  return geo.country || geo.region || geo.city ? geo : null;
}

/**
 * The default lookup: `GEOIP_URL` with `{ip}` replaced. This sends visitors'
 * IP addresses to that service (docs/sign-in-history.md); unset, nothing is
 * sent and the city stays empty.
 */
export const lookupGeo: GeoLookup = async (ip) => {
  const template = env.GEOIP_URL;
  if (!template || !isPublicIp(ip)) return null;
  try {
    const response = await fetch(
      template.replace("{ip}", encodeURIComponent(ip)),
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      logger.warn("auth.geo_lookup_failed", { status: response.status });
      return null;
    }
    return parseGeo(await response.json());
  } catch (error) {
    logger.warn("auth.geo_lookup_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
};

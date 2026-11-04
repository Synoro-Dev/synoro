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
 * Whether a geo service can say anything about the address: not a private,
 * loopback or link-local one (a dev machine, or a proxy that hides the
 * client's IP), and never sent to a third party.
 */
export function isPublicIp(ip: string) {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind !== 6) return false;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped?.[1]) return isPublicV4(mapped[1]);
  if (lower === "::" || lower === "::1") return false;
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  return !/^(f[cd]|fe[89ab]|ff)/.test(lower);
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

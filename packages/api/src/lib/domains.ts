import { resolve4, resolveCname, resolveTxt } from "node:dns/promises";
import { domainToUnicode } from "node:url";
import { env } from "@synoro/config";
import { type Database, eq, Practice, PracticeDomain } from "@synoro/db";
import { RESERVED_SLUGS } from "@synoro/validators";

type DomainRow = typeof PracticeDomain.$inferSelect;

/** TXT record (under the connected host) that proves ownership. */
const VERIFICATION_PREFIX = "_booking-verification";

/** Pending reservations expire 24 hours after the hostname/token is set. */
export const DOMAIN_RESERVATION_MS = 24 * 60 * 60 * 1000;

const verificationRecordName = (hostname: string) =>
  `${VERIFICATION_PREFIX}.${hostname}`;

const platformRoot = () =>
  env.PRACTICE_ROOT_DOMAIN?.trim().toLowerCase() || undefined;

const appUrl = () => new URL(env.APP_URL);

/** The slug a platform subdomain stands for: `anna` for `anna.<root>`. */
export function slugFromPlatformHost(host: string, root = platformRoot()) {
  if (!root || !host.endsWith(`.${root}`)) return undefined;
  const label = host.slice(0, -root.length - 1);
  if (!label || label.includes(".") || RESERVED_SLUGS.has(label)) {
    return undefined;
  }
  return label;
}

/** `https://anna.<root>` (scheme and port follow APP_URL), if enabled. */
function platformUrl(slug: string) {
  const root = platformRoot();
  if (!root) return null;
  const url = appUrl();
  url.hostname = `${slug}.${root}`;
  return url.origin;
}

/** The platform's own hosts and everything under them can't be claimed. */
export function isPlatformHost(hostname: string) {
  return [platformRoot(), appUrl().hostname].some(
    (own) => own && (hostname === own || hostname.endsWith(`.${own}`)),
  );
}

export interface DnsTargets {
  cname?: string;
  ip?: string;
}

function dnsTargets(): DnsTargets {
  return {
    cname: env.CUSTOM_DOMAIN_CNAME?.trim().toLowerCase() || undefined,
    ip: env.CUSTOM_DOMAIN_IP,
  };
}

// A type alias (not an interface) so router declarations can inline it.
type DnsRecord = {
  type: "TXT" | "CNAME" | "A";
  name: string;
  value: string;
  purpose: "ownership" | "routing";
  /** For routing: the record that fits this host (CNAME vs apex A). */
  recommended: boolean;
};

/**
 * Records the specialist adds at their registrar. An apex domain can't hold
 * a CNAME, so it gets an A record; two labels is a guess at "apex" (wrong
 * for `anna.msk.ru`), which is why both routing options are listed.
 */
function dnsRecords(row: DomainRow, targets = dnsTargets()) {
  const apex = row.hostname.split(".").length === 2;
  const records: DnsRecord[] = [
    {
      type: "TXT",
      name: verificationRecordName(row.hostname),
      value: row.verificationToken,
      purpose: "ownership",
      recommended: true,
    },
  ];
  if (targets.cname) {
    records.push({
      type: "CNAME",
      name: row.hostname,
      value: targets.cname,
      purpose: "routing",
      recommended: !apex || !targets.ip,
    });
  }
  if (targets.ip) {
    records.push({
      type: "A",
      name: row.hostname,
      value: targets.ip,
      purpose: "routing",
      recommended: apex || !targets.cname,
    });
  }
  return records;
}

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

const systemResolver: DnsResolver = { resolveTxt, resolveCname, resolve4 };

const none = (): string[] => [];

/**
 * Live DNS check. `ownership`: the TXT record holds the token. `routing`:
 * the host points here — CNAME to the target, A to the target IP, or the
 * same addresses as the target (CNAME flattening at the apex).
 */
export async function checkDomainDns(
  hostname: string,
  token: string,
  targets: DnsTargets = dnsTargets(),
  resolver: DnsResolver = systemResolver,
) {
  const [txt, cnames, addresses, targetAddresses] = await Promise.all([
    resolver
      .resolveTxt(verificationRecordName(hostname))
      .catch((): string[][] => []),
    resolver.resolveCname(hostname).catch(none),
    resolver.resolve4(hostname).catch(none),
    targets.cname ? resolver.resolve4(targets.cname).catch(none) : none(),
  ]);

  const ownership = txt.some((chunks) => chunks.join("").trim() === token);
  const routing =
    (!!targets.cname &&
      cnames.some(
        (c) => c.toLowerCase().replace(/\.$/, "") === targets.cname,
      )) ||
    (!!targets.ip && addresses.includes(targets.ip)) ||
    addresses.some((ip) => targetAddresses.includes(ip));

  return { ownership, routing };
}

/** What the domain settings page shows for a practice. */
export async function domainSettings(db: Database, practiceId: string) {
  const [practice, row] = await Promise.all([
    db.query.Practice.findFirst({
      where: eq(Practice.id, practiceId),
      columns: { slug: true },
    }),
    db.query.PracticeDomain.findFirst({
      where: eq(PracticeDomain.practiceId, practiceId),
    }),
  ]);
  const targets = dnsTargets();

  return {
    platformUrl: practice ? platformUrl(practice.slug) : null,
    targetsConfigured: !!(targets.cname || targets.ip),
    domain: row
      ? {
          hostname: row.hostname,
          displayHostname: domainToUnicode(row.hostname) || row.hostname,
          status: row.status,
          verifiedAt: row.verifiedAt,
          lastCheckedAt: row.lastCheckedAt,
          records: dnsRecords(row, targets),
        }
      : null,
  };
}

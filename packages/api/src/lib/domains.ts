import {
  resolve4,
  resolve6,
  resolveCname,
  resolveTxt,
} from "node:dns/promises";
import { domainToUnicode } from "node:url";
import { env } from "@synoro/config";
import {
  and,
  type Database,
  eq,
  isNotNull,
  Practice,
  PracticeDomain,
} from "@synoro/db";
import {
  leadsToTarget,
  lookupDns,
  servesHttps,
} from "@synoro/jobs/custom-domains";
import { getDomain } from "tldts";

import { hasPro } from "./billing";
import { publicBookingUrl } from "./urls";

type DomainRow = typeof PracticeDomain.$inferSelect;

/** TXT record (under the connected host) that proves ownership. */
const VERIFICATION_PREFIX = "_booking-verification";

/** Pending reservations expire 24 hours after the hostname/token is set. */
export const DOMAIN_RESERVATION_MS = 24 * 60 * 60 * 1000;

/** FQDN of the TXT record that proves ownership. */
const verificationRecordName = (hostname: string) =>
  `${VERIFICATION_PREFIX}.${hostname}`;

/** Hostnames of the exact (non-wildcard) AUTH_TRUSTED_ORIGINS. */
const trustedHosts = () =>
  (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .filter((origin) => origin && !/[*?]/.test(origin))
    .map((origin) => new URL(origin).hostname);

/** The platform's own hosts and everything under them can't be claimed. */
export function isPlatformHost(hostname: string) {
  return [
    new URL(env.APP_URL).hostname,
    new URL(env.BOOKING_URL ?? env.APP_URL).hostname,
    ...trustedHosts(),
  ].some((own) => hostname === own || hostname.endsWith(`.${own}`));
}

/**
 * Where specialists point their domains. A name, never an address: the host
 * behind it can move without anyone editing their DNS.
 */
export interface DnsTargets {
  cname?: string;
}

function dnsTargets(): DnsTargets {
  return {
    cname: env.CUSTOM_DOMAIN_CNAME?.trim().toLowerCase() || undefined,
  };
}

/**
 * The zone the owner edits at their registrar: the registered domain
 * (`stariva.ru` for `booking.stariva.ru`, `anna.co.uk` for itself), by the
 * public suffix list.
 */
const dnsZone = (hostname: string) =>
  getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;

// A type alias (not an interface) so router declarations can inline it.
type DnsRecord = {
  type: "TXT" | "CNAME" | "ALIAS";
  name: string;
  value: string;
  purpose: "ownership" | "routing";
  /** For routing: the record that fits this host (CNAME vs apex ALIAS). */
  recommended: boolean;
};

/**
 * Records the specialist adds at their registrar. Routing is always a name:
 * a CNAME for a subdomain. An apex domain can't hold a CNAME, so it also gets
 * an ALIAS (ANAME, «CNAME flattening» at some registrars) to the same target;
 * where there is none, a subdomain such as `zapis.<domain>` does the job.
 * The apex comes from the public suffix list, which can't know a zone
 * delegated below the registered domain — so a CNAME stays listed beside
 * the ALIAS.
 */
function dnsRecords(row: DomainRow, targets = dnsTargets()) {
  const zone = dnsZone(row.hostname);
  const apex = row.hostname === zone;
  // Names are shown relative to the domain's zone — what the registrar's
  // «Имя» field expects — so the owner never pastes their whole domain.
  const displayZone = displayHost(zone);
  const recordName = (fqdn: string) => {
    const name = domainToUnicode(fqdn) || fqdn;
    return name === displayZone
      ? "@"
      : name.slice(0, name.length - displayZone.length - 1);
  };
  const records: DnsRecord[] = [
    {
      type: "TXT",
      name: recordName(verificationRecordName(row.hostname)),
      value: row.verificationToken,
      purpose: "ownership",
      recommended: true,
    },
  ];
  if (targets.cname) {
    records.push({
      type: "CNAME",
      name: recordName(row.hostname),
      value: targets.cname,
      purpose: "routing",
      recommended: !apex,
    });
    if (apex) {
      records.push({
        type: "ALIAS",
        name: recordName(row.hostname),
        value: targets.cname,
        purpose: "routing",
        recommended: true,
      });
    }
  }
  return records;
}

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

const systemResolver: DnsResolver = {
  resolveTxt,
  resolveCname,
  resolve4,
  resolve6,
};

/**
 * Live DNS check. `ownership`: the TXT record holds the token. `routing`:
 * the host points here — a CNAME to the target, or only the target's own
 * addresses, IPv4 and IPv6 (an ALIAS / CNAME flattening at the apex). The
 * rule is `leadsToTarget`, shared with the routes sync.
 */
export async function checkDomainDns(
  hostname: string,
  token: string,
  targets: DnsTargets = dnsTargets(),
  resolver: DnsResolver = systemResolver,
) {
  const [txt, dns] = await Promise.all([
    resolver
      .resolveTxt(verificationRecordName(hostname))
      .catch((): string[][] => []),
    lookupDns(hostname, targets.cname, resolver),
  ]);

  const ownership = txt.some((chunks) => chunks.join("").trim() === token);
  const routing = leadsToTarget(targets.cname, dns);

  return { ownership, routing };
}

/**
 * Does `https://<hostname>` already serve this practice on the platform — a
 * trusted certificate, the route, the app? Asked through our own entry point
 * (`CUSTOM_DOMAIN_CNAME`), so another server the host may point at can't
 * answer for us; without it nothing can lead here. Only worth asking once DNS
 * leads here: the cluster requests the certificate then
 * (docs/custom-domains.md, «Hosting»).
 */
export async function checkHttps(hostname: string, practiceId: string) {
  const via = dnsTargets().cname;
  return !!via && (await servesHttps(hostname, via, practiceId));
}

/**
 * Where the connection stands, for the owner's progress steps:
 * `ownership` (TXT) → `routing` (CNAME / ALIAS) → `certificate` (https is
 * being issued) → `ready`.
 */
export type DomainStage = "ownership" | "routing" | "certificate" | "ready";

/** `xn--…` back into the letters the owner typed (`анна.рф`). */
const displayHost = (hostname: string) => domainToUnicode(hostname) || hostname;

/** Joins a practice to its domain once that fully works (TXT, DNS, https). */
export const readyDomainOn = (practiceId: typeof Practice.id) =>
  and(
    eq(PracticeDomain.practiceId, practiceId),
    eq(PracticeDomain.status, "active"),
    isNotNull(PracticeDomain.securedAt),
  );

/**
 * The practice's own domain, for the console to show in place of the
 * platform address — only once it fully works, so a shared link never lands
 * on a browser warning.
 */
export function siteDomain(hostname: string | null | undefined) {
  return hostname
    ? { hostname: displayHost(hostname), url: `https://${hostname}` }
    : null;
}

/** What the domain settings page shows for a practice. */
export async function domainSettings(db: Database, practiceId: string) {
  const [practice, row] = await Promise.all([
    db.query.Practice.findFirst({
      where: eq(Practice.id, practiceId),
      columns: { slug: true, ownerId: true },
    }),
    db.query.PracticeDomain.findFirst({
      where: eq(PracticeDomain.practiceId, practiceId),
    }),
  ]);
  const targets = dnsTargets();

  return {
    /** Connecting an own domain is «Про». */
    pro: practice ? await hasPro(db, practice.ownerId) : false,
    bookingUrl: practice ? publicBookingUrl(practice.slug) : null,
    targetsConfigured: !!targets.cname,
    domain: row
      ? {
          hostname: row.hostname,
          displayHostname: displayHost(row.hostname),
          status: row.status,
          verifiedAt: row.verifiedAt,
          lastCheckedAt: row.lastCheckedAt,
          /** https answered with a trusted certificate: fully ready. */
          securedAt: row.securedAt,
          url: `https://${row.hostname}`,
          /** The zone record names are relative to (`@` is the zone itself). */
          zone: displayHost(dnsZone(row.hostname)),
          records: dnsRecords(row, targets),
        }
      : null,
  };
}

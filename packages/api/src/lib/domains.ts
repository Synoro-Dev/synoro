import { resolve4, resolveCname, resolveTxt } from "node:dns/promises";
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
import { hasTrustedCertificate } from "@synoro/jobs/custom-domains";

import { hasPro } from "./billing";
import { publicBookingUrl } from "./urls";

type DomainRow = typeof PracticeDomain.$inferSelect;

/** TXT record (under the connected host) that proves ownership. */
const VERIFICATION_PREFIX = "_booking-verification";

/** Pending reservations expire 24 hours after the hostname/token is set. */
export const DOMAIN_RESERVATION_MS = 24 * 60 * 60 * 1000;

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
 * Two labels is a guess at "apex" (wrong for `anna.msk.ru`), which is why a
 * CNAME stays listed beside the ALIAS.
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
      recommended: !apex,
    });
    if (apex) {
      records.push({
        type: "ALIAS",
        name: row.hostname,
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
}

const systemResolver: DnsResolver = { resolveTxt, resolveCname, resolve4 };

const none = (): string[] => [];

/**
 * Live DNS check. `ownership`: the TXT record holds the token. `routing`:
 * the host points here — a CNAME to the target, or the same addresses as the
 * target (an ALIAS / CNAME flattening at the apex, which answers with A
 * records). No address is configured anywhere: the target's own are read.
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
    addresses.some((ip) => targetAddresses.includes(ip));

  return { ownership, routing };
}

/**
 * Does `https://<hostname>` already work with a trusted certificate? Only
 * worth asking once DNS leads here: the cluster requests the certificate then
 * (docs/custom-domains.md, «Hosting»).
 */
export function checkCertificate(hostname: string) {
  return hasTrustedCertificate(hostname);
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
          records: dnsRecords(row, targets),
        }
      : null,
  };
}

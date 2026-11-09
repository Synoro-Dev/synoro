import { resolve4, resolveCname } from "node:dns/promises";
import { connect } from "node:tls";

/**
 * Hosting side of the practices' own domains (docs/custom-domains.md): which
 * Traefik routes the cluster should have, as pure functions. The script that
 * talks to the database and to Kubernetes is `scripts/sync-domains.ts`.
 *
 * Traefik has no «issue on first request» mode: it asks Let's Encrypt for the
 * hosts named in its routes. So every connected domain gets a route of its own
 * (one certificate each, and one failing domain never holds up another).
 */

/** Marks the routes this code owns; nothing else is ever listed or deleted. */
export const MANAGED_LABEL = "app.kubernetes.io/managed-by";
export const MANAGED_BY = "synoro-domains-sync";

const ROUTE_PREFIX = "cd-";

/** Lowercase ASCII labels (IDN is already punycode), 2+ of them, ≤ 240 chars. */
const HOST =
  /^(?=.{4,240}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * The host goes into a Traefik rule between backticks and into an object name:
 * anything but a plain hostname is refused, whatever the database holds.
 */
const isSafeHost = (host: string) => HOST.test(host);

/** The platform's own hosts and everything under them are never custom. */
function isOwnHost(host: string, ownHosts: readonly string[]) {
  return ownHosts.some((own) => host === own || host.endsWith(`.${own}`));
}

export const routeName = (host: string) => `${ROUTE_PREFIX}${host}`;

/** The host a managed route serves, from its name. */
export const hostOfRoute = (name: string) =>
  name.startsWith(ROUTE_PREFIX) ? name.slice(ROUTE_PREFIX.length) : undefined;

export interface RouteTarget {
  /** Kubernetes Service in the route's namespace. */
  service: string;
  /** Its named port. */
  port: string;
  /** The Traefik certificate resolver (HTTP-01 on `web`). */
  certResolver: string;
}

/** Traefik IngressRoute for one connected domain, as the API takes it. */
export function ingressRoute(host: string, target: RouteTarget) {
  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: {
      name: routeName(host),
      labels: {
        [MANAGED_LABEL]: MANAGED_BY,
        "app.kubernetes.io/component": "custom-domain",
      },
      annotations: { "synoro.ru/hostname": host },
    },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          kind: "Rule",
          match: `Host(\`${host}\`)`,
          services: [{ name: target.service, port: target.port }],
        },
      ],
      tls: { certResolver: target.certResolver },
    },
  };
}

export interface DnsTargets {
  cname?: string;
}

export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

const systemResolver: DnsResolver = { resolveCname, resolve4 };
const none = (): string[] => [];

/**
 * Does the host's DNS already lead here? A certificate request for a host that
 * doesn't would fail, and Traefik doesn't retry on its own. Same rule as the
 * `routing` half of `checkDomainDns` in `@synoro/api` (keep them in step):
 * a CNAME to the target, or the target's own addresses (an ALIAS / CNAME
 * flattening at the apex). No address is configured: the target's are read.
 */
export async function reachesUs(
  host: string,
  targets: DnsTargets,
  resolver: DnsResolver = systemResolver,
) {
  const [cnames, addresses, targetAddresses] = await Promise.all([
    resolver.resolveCname(host).catch(none),
    resolver.resolve4(host).catch(none),
    targets.cname ? resolver.resolve4(targets.cname).catch(none) : none(),
  ]);
  return (
    (!!targets.cname &&
      cnames.some(
        (c) => c.toLowerCase().replace(/\.$/, "") === targets.cname,
      )) ||
    addresses.some((ip) => targetAddresses.includes(ip))
  );
}

/** Opens a TLS connection to the host; `true` when its certificate is trusted. */
export type CertificateProbe = (host: string) => Promise<boolean>;

/**
 * Does `https://<host>` answer with a certificate a browser trusts (a public
 * CA, valid now, issued for this host)? Until Let's Encrypt issues one Traefik
 * serves its own self-signed default, which fails here. Only the handshake:
 * nothing is sent. Call it for hosts whose DNS leads to us.
 */
export const hasTrustedCertificate: CertificateProbe = (host) =>
  new Promise((resolve) => {
    const socket = connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: true,
        timeout: 5_000,
      },
      () => {
        resolve(socket.authorized);
        socket.end();
      },
    );
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });

/**
 * What to do so the cluster matches the database.
 *
 * - `apply`: hosts that should have a route (created or refreshed).
 * - `remove`: managed routes whose host is gone, disconnected, or refused.
 * - `waiting`: verified hosts whose DNS doesn't lead here yet. A route that
 *   already exists stays through a DNS blip; only a new one waits.
 * - `refused`: not a plain hostname, or one of the platform's own.
 */
export async function planRoutes({
  active,
  existing,
  ownHosts,
  reaches,
}: {
  active: readonly string[];
  existing: readonly string[];
  ownHosts: readonly string[];
  reaches: (host: string) => Promise<boolean>;
}) {
  const have = new Set(existing);
  const apply: string[] = [];
  const waiting: string[] = [];
  const refused: string[] = [];

  const candidates: string[] = [];
  for (const host of new Set(active)) {
    if (!isSafeHost(host) || isOwnHost(host, ownHosts)) refused.push(host);
    else candidates.push(host);
  }

  const results = await Promise.all(
    candidates.map(async (host) => have.has(host) || (await reaches(host))),
  );
  candidates.forEach((host, i) => {
    (results[i] ? apply : waiting).push(host);
  });

  const wanted = new Set(apply);
  return {
    apply,
    remove: existing.filter((host) => !wanted.has(host)),
    waiting,
    refused,
  };
}

import { resolve4, resolveCname } from "node:dns/promises";
import { request } from "node:https";

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

/** Where the readiness probe asks a host which practice it serves. */
export const DOMAIN_CHECK_PATH = "/api/domains/check";

/** `true` when `https://<host>` serves `practiceId` on the platform. */
export type HttpsProbe = (
  host: string,
  via: string,
  practiceId: string,
) => Promise<boolean>;

/**
 * Does `https://<host>` work on the platform for this practice? It asks
 * `/api/domains/check` there, which answers only after the practice is
 * resolved by `Host`: a certificate a browser trusts (a public CA, valid now,
 * issued for this host), the route, the app and the database, and the very
 * practice expected. Until Let's Encrypt issues a certificate, Traefik serves
 * its own self-signed default, which fails here; a route without a working
 * app answers 404/502, which fails too.
 *
 * It connects to `via` — the platform's own entry point
 * (`CUSTOM_DOMAIN_CNAME`) — with the host as SNI and `Host`, so the answer is
 * ours and never another server's. Whether the host's DNS leads here is a
 * separate question (`reachesUs`): ask both.
 */
export const servesHttps: HttpsProbe = (host, via, practiceId) =>
  probeHttps({ host, via, practiceId });

/**
 * `servesHttps` with the knobs tests need: another port, and a CA to trust
 * instead of the public ones (`test/fixtures/tls`). Production never sets them.
 */
export function probeHttps({
  host,
  via,
  practiceId,
  port = 443,
  ca,
}: {
  host: string;
  via: string;
  practiceId: string;
  port?: number;
  ca?: string;
}) {
  return new Promise<boolean>((resolve) => {
    const req = request(
      {
        host: via,
        port,
        ca,
        path: DOMAIN_CHECK_PATH,
        method: "GET",
        servername: host,
        headers: {
          host,
          accept: "application/json",
          "user-agent": "synoro-domain-check",
        },
        rejectUnauthorized: true,
        agent: false,
        timeout: 5_000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          resolve(false);
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          // `{"practiceId":"<uuid>"}` is tiny: anything bigger isn't ours.
          if (body.length > 1_024) {
            resolve(false);
            response.destroy();
          }
        });
        // Only a body that arrived whole counts; the first settle wins.
        response.on("end", () => {
          try {
            resolve(
              (JSON.parse(body) as { practiceId?: unknown }).practiceId ===
                practiceId,
            );
          } catch {
            resolve(false);
          }
        });
        response.on("error", () => resolve(false));
        response.on("close", () => resolve(false));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Which domains work now (`secure`: to mark) and which stopped (`unsecure`:
 * to unmark). Works = it has a route, its DNS leads here — checked on its
 * own, because a route stays through a DNS change — and the platform serves
 * its practice over https. Without a target (`via`) nothing can lead here.
 */
export async function planReadiness({
  domains,
  routed,
  via,
  reaches,
  probe,
}: {
  domains: readonly {
    hostname: string;
    practiceId: string;
    securedAt: Date | null;
  }[];
  routed: ReadonlySet<string>;
  via: string | undefined;
  reaches: (host: string) => Promise<boolean>;
  probe: HttpsProbe;
}) {
  const works = await Promise.all(
    domains.map(
      async ({ hostname, practiceId }) =>
        !!via &&
        routed.has(hostname) &&
        (await reaches(hostname)) &&
        (await probe(hostname, via, practiceId)),
    ),
  );
  return {
    secure: domains
      .filter((domain, i) => works[i] && !domain.securedAt)
      .map((domain) => domain.hostname),
    unsecure: domains
      .filter((domain, i) => !works[i] && domain.securedAt)
      .map((domain) => domain.hostname),
  };
}

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

import { resolve4, resolve6, resolveCname } from "node:dns/promises";
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
  resolve6(hostname: string): Promise<string[]>;
}

const systemResolver: DnsResolver = { resolveCname, resolve4, resolve6 };
const none = (): string[] => [];

/** What DNS answered for a host and for our target (`CUSTOM_DOMAIN_CNAME`). */
export interface DnsAnswers {
  cnames: string[];
  v4: string[];
  v6: string[];
  targetV4: string[];
  targetV6: string[];
}

/**
 * Does a host lead here, by its DNS answers? A CNAME to the target, or — an
 * ALIAS / CNAME flattening at the apex — **every** address it answers with,
 * IPv4 and IPv6, is one of the target's. One foreign A or AAAA among ours
 * sends some visitors (and Let's Encrypt, which prefers IPv6) elsewhere, so
 * it doesn't count. No address is configured: the target's are read. The one
 * rule for `checkDomainDns` in `@synoro/api` and `reachesUs` here.
 */
export function leadsToTarget(target: string | undefined, dns: DnsAnswers) {
  if (!target) return false;
  if (dns.cnames.some((c) => c.toLowerCase().replace(/\.$/, "") === target)) {
    return true;
  }
  return (
    dns.v4.length + dns.v6.length > 0 &&
    dns.v4.every((ip) => dns.targetV4.includes(ip)) &&
    dns.v6.every((ip) => dns.targetV6.includes(ip))
  );
}

/** Looks up what `leadsToTarget` needs, a missing record being none. */
export async function lookupDns(
  host: string,
  target: string | undefined,
  resolver: DnsResolver = systemResolver,
): Promise<DnsAnswers> {
  const [cnames, v4, v6, targetV4, targetV6] = await Promise.all([
    resolver.resolveCname(host).catch(none),
    resolver.resolve4(host).catch(none),
    resolver.resolve6(host).catch(none),
    target ? resolver.resolve4(target).catch(none) : none(),
    target ? resolver.resolve6(target).catch(none) : none(),
  ]);
  return { cnames, v4, v6, targetV4, targetV6 };
}

/**
 * Does the host's DNS already lead here? A certificate request for a host that
 * doesn't would fail, and Traefik doesn't retry on its own.
 */
export async function reachesUs(
  host: string,
  targets: DnsTargets,
  resolver: DnsResolver = systemResolver,
) {
  return leadsToTarget(
    targets.cname,
    await lookupDns(host, targets.cname, resolver),
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
  timeoutMs = 5_000,
}: {
  host: string;
  via: string;
  practiceId: string;
  port?: number;
  ca?: string;
  /** For the whole exchange, however slowly the bytes trickle in. */
  timeoutMs?: number;
}) {
  return new Promise<boolean>((resolve) => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    // The first answer wins; whatever comes after is ignored.
    const settle = (ready: boolean) => {
      clearTimeout(deadline);
      resolve(ready);
      if (!ready) req.destroy();
    };
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
        timeout: timeoutMs,
      },
      (response) => {
        if (response.statusCode !== 200) {
          settle(false);
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          // `{"practiceId":"<uuid>"}` is tiny: anything bigger isn't ours.
          if (body.length > 1_024) settle(false);
        });
        // Only a body that arrived whole counts.
        response.on("end", () => {
          try {
            settle(
              (JSON.parse(body) as { practiceId?: unknown }).practiceId ===
                practiceId,
            );
          } catch {
            settle(false);
          }
        });
        response.on("error", () => settle(false));
        response.on("close", () => settle(false));
      },
    );
    // An idle socket times out on its own; a slow trickle needs this.
    deadline = setTimeout(() => settle(false), timeoutMs);
    req.on("error", () => settle(false));
    req.on("timeout", () => settle(false));
    req.end();
  });
}

/**
 * Which domains work now (`secure`: to mark) and which stopped (`unsecure`:
 * to unmark). Works = it has a route, its DNS leads here — checked on its
 * own, because a route stays through a DNS change — and the platform serves
 * its practice over https. Without a target (`via`) nothing can lead here.
 */
export async function planReadiness<
  Domain extends {
    hostname: string;
    practiceId: string;
    securedAt: Date | null;
  },
>({
  domains,
  routed,
  via,
  reaches,
  probe,
  concurrency = 8,
}: {
  domains: readonly Domain[];
  routed: ReadonlySet<string>;
  via: string | undefined;
  reaches: (host: string) => Promise<boolean>;
  probe: HttpsProbe;
  /** Domains checked at once: thousands of requests at a time would fail. */
  concurrency?: number;
}) {
  const works = new Array<boolean>(domains.length).fill(false);
  let next = 0;
  const worker = async () => {
    while (next < domains.length) {
      const i = next++;
      const { hostname, practiceId } = domains[i] as Domain;
      works[i] =
        !!via &&
        routed.has(hostname) &&
        (await reaches(hostname)) &&
        (await probe(hostname, via, practiceId));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, domains.length) }, worker),
  );
  // The checked records themselves: the caller updates exactly those.
  return {
    secure: domains.filter((domain, i) => works[i] && !domain.securedAt),
    unsecure: domains.filter((domain, i) => !works[i] && domain.securedAt),
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

import { env } from "@synoro/config";

/** Where the app itself lives: auth, dashboard, the session cookie. */
export const appUrl = env.APP_URL;

/**
 * Main address of the public booking pages (`BOOKING_URL`, e.g.
 * https://synoro.ru), else the app itself.
 */
export const bookingUrl = (slug: string) =>
  new URL(`/p/${slug}`, env.BOOKING_URL ?? appUrl).href;

/**
 * Where `/p/<slug>` should live when it was opened on another app host
 * (app.synoro.ru/p/anna → synoro.ru/p/anna), so one address is the real one.
 * Only when `BOOKING_URL` is set and the request came in on a different host.
 */
export function bookingRedirect(
  request: { pathname: string; search: string; host: string | null },
  bookingOrigin: string | undefined,
) {
  if (!bookingOrigin || !request.pathname.startsWith("/p/")) return undefined;
  const target = new URL(`${request.pathname}${request.search}`, bookingOrigin);
  return request.host?.trim().toLowerCase() === target.host
    ? undefined
    : target;
}

const hostnameOf = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
};

/**
 * Exact AUTH_TRUSTED_ORIGINS (e.g. https://synoro.ru) serve the app too.
 * Wildcards are left out: `*.synoro.ru` also matches practice subdomains.
 */
const trustedAppOrigins = () =>
  (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .filter((origin) => origin && !/[*?]/.test(origin));

export interface HostConfig {
  /** Hosts that serve the app rather than a practice page. */
  appHosts: ReadonlySet<string>;
  /** `PRACTICE_ROOT_DOMAIN`: the bare root and `www.` are the app too. */
  rootDomain?: string;
}

export function hostConfig(): HostConfig {
  const rootDomain =
    env.PRACTICE_ROOT_DOMAIN?.trim().toLowerCase() || undefined;
  const hosts = [appUrl, env.NEXT_PUBLIC_APP_URL, ...trustedAppOrigins()].map(
    hostnameOf,
  );
  return {
    appHosts: new Set(
      [...hosts, "localhost", "127.0.0.1", "[::1]"].filter(
        (h): h is string => !!h,
      ),
    ),
    rootDomain,
  };
}

/**
 * The practice host a request is for, or undefined for the app's own hosts.
 * Everything else — `anna.<root>` or a connected domain — is a practice
 * page; which practice (if any) is resolved by `practice.byHost`.
 */
export function practiceHost(
  hostHeader: string | null,
  { appHosts, rootDomain }: HostConfig,
) {
  const host = hostHeader
    ?.trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (!host || appHosts.has(host)) return undefined;
  if (rootDomain && (host === rootDomain || host === `www.${rootDomain}`)) {
    return undefined;
  }
  return host;
}

import { env, paths } from "@synoro/config";
import { legacyPracticePath, practiceSlugOfPath } from "@synoro/validators";

/** Where the app itself lives: auth, dashboard, the session cookie. */
export const appUrl = env.APP_URL;

/**
 * Main address of the public booking pages (`BOOKING_URL`, e.g.
 * https://synoro.ru), else the app itself.
 */
export const bookingUrl = (slug: string) =>
  new URL(paths.booking.public(slug), env.BOOKING_URL ?? appUrl).href;

/**
 * Where a booking page should live when it was opened on another app host
 * (app.synoro.ru/anna or the old app.synoro.ru/p/anna → synoro.ru/anna), so
 * one address is the real one. Only when `BOOKING_URL` is set and the request
 * came in on a different host.
 */
export function bookingRedirect(
  request: { pathname: string; search: string; host: string | null },
  bookingOrigin: string | undefined,
) {
  if (!bookingOrigin) return undefined;
  const pathname =
    legacyPracticePath(request.pathname) ??
    (practiceSlugOfPath(request.pathname) ? request.pathname : undefined);
  if (!pathname) return undefined;
  const target = new URL(`${pathname}${request.search}`, bookingOrigin);
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
 * Wildcards are left out: a pattern can't name a host to compare with.
 */
const trustedAppOrigins = () =>
  (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .filter((origin) => origin && !/[*?]/.test(origin));

export interface HostConfig {
  /** Hosts that serve the app rather than a practice page. */
  appHosts: ReadonlySet<string>;
}

export function hostConfig(): HostConfig {
  const hosts = [
    appUrl,
    env.BOOKING_URL,
    env.NEXT_PUBLIC_APP_URL,
    ...trustedAppOrigins(),
  ].map(hostnameOf);
  return {
    appHosts: new Set(
      [...hosts, "localhost", "127.0.0.1", "[::1]"].filter(
        (h): h is string => !!h,
      ),
    ),
  };
}

/**
 * The practice host a request is for, or undefined for the app's own hosts.
 * Everything else is taken for a connected domain; which practice (if any) is
 * resolved by `practice.byHost`.
 */
export function practiceHost(
  hostHeader: string | null,
  { appHosts }: HostConfig,
) {
  const host = hostHeader
    ?.trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (!host || appHosts.has(host)) return undefined;
  return host;
}

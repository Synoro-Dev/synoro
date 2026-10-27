import { env } from "@synoro/config";

const vercelUrl =
  env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
    : env.VERCEL_ENV === "preview" && env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : undefined;

/** Where the app itself lives: auth, dashboard, the session cookie. */
export const appUrl = vercelUrl ?? env.APP_URL;

const hostnameOf = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
};

export interface HostConfig {
  /** Hosts that serve the app rather than a practice page. */
  appHosts: ReadonlySet<string>;
  /** `PRACTICE_ROOT_DOMAIN`: the bare root and `www.` are the app too. */
  rootDomain?: string;
}

export function hostConfig(): HostConfig {
  const rootDomain =
    env.PRACTICE_ROOT_DOMAIN?.trim().toLowerCase() || undefined;
  const hosts = [
    appUrl,
    env.APP_URL,
    env.NEXT_PUBLIC_APP_URL,
    env.VERCEL_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
  ].map(hostnameOf);
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
  if (!host || appHosts.has(host) || host.endsWith(".vercel.app")) {
    return undefined;
  }
  if (rootDomain && (host === rootDomain || host === `www.${rootDomain}`)) {
    return undefined;
  }
  return host;
}

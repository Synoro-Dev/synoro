import type { NextConfig } from "next";

import { env } from "./src/env";

/**
 * Browser analytics goes through `/ingest` on our own origin (ad blockers
 * block the PostHog hosts). Static assets live on a separate `-assets` host in
 * PostHog Cloud; a self-hosted instance serves both from one.
 * @see https://posthog.com/docs/advanced/proxy/nextjs
 */
const posthogHost = env.NEXT_PUBLIC_POSTHOG_HOST;
const posthogAssetsHost = posthogHost.replace(
  /^(https:\/\/\w+)\.i\.posthog\.com$/,
  "$1-assets.i.posthog.com",
);

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

export default async function createNextConfig(): Promise<NextConfig> {
  const config: NextConfig = {
    output: "standalone",
    /**
     * synoro.ru/_next/ is routed to the app (infra/synoro/app.yaml), so the
     * landing serves its chunks from its own prefix. Next strips it itself;
     * Traefik sends it to the landing via the synoro.ru catch-all.
     */
    assetPrefix: "/_landing",
    /** Workspace packages consumed as TypeScript source (`exports` → src/). */
    transpilePackages: ["@synoro/ui"],
    typedRoutes: true,
    reactCompiler: true,
    cacheComponents: true,
    partialPrefetching: true,

    /** Required by the PostHog proxy: `/ingest/e/` must not be redirected. */
    skipTrailingSlashRedirect: true,

    async rewrites() {
      if (!env.NEXT_PUBLIC_POSTHOG_KEY) return [];
      return [
        {
          source: "/ingest/static/:path*",
          destination: `${posthogAssetsHost}/static/:path*`,
        },
        {
          source: "/ingest/array/:path*",
          destination: `${posthogAssetsHost}/array/:path*`,
        },
        { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
      ];
    },

    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };

  return config;
}

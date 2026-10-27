import type { NextConfig } from "next";

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

    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };

  return config;
}

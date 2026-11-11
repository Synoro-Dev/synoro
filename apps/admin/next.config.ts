import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Same baseline as apps/app, stricter: no third-party scripts at all (no
 * Metrika, no PostHog) and nothing may frame the admin site.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

export default async function createNextConfig(): Promise<NextConfig> {
  const config: NextConfig = {
    output: "standalone",
    poweredByHeader: false,
    /** Workspace packages consumed as TypeScript source (`exports` → src/). */
    transpilePackages: [
      "@synoro/api",
      "@synoro/auth",
      "@synoro/db",
      "@synoro/jobs",
      "@synoro/ui",
      "@synoro/validators",
    ],
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

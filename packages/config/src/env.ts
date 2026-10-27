import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const httpOrigin = z
  .url({ protocol: /^https?$/ })
  .refine(
    (value) => !new URL(value).hostname.includes("*"),
    "Expected an HTTP(S) URL without host wildcards",
  )
  .transform((value) => new URL(value).origin);

// Better Auth matches wildcard patterns against the origin (with a scheme)
// or host (without one). Normalize without parsing wildcard characters as URLs.
const wildcardOrigin = z
  .string()
  .regex(/^(?:https?:\/\/)?[a-z0-9.*?-]+(?::[0-9*?]+)?$/i)
  .refine((value) => /[*?]/.test(value), "Expected a wildcard pattern")
  .refine((value) => {
    const url = value.includes("://") ? value : `https://${value}`;
    return httpOrigin.safeParse(url.replace(/[*?]/g, "1")).success;
  }, "Invalid origin wildcard pattern")
  .transform((value) =>
    value
      .toLowerCase()
      .replace(/^(https?:\/\/[^:]+):\d+$/, (pattern, origin) => {
        const port = new URL(pattern.replace(/[*?]/g, "1")).port;
        return `${origin}${port ? `:${port}` : ""}`;
      }),
  );

export const env = createEnv({
  server: {
    // Node environment
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),

    // Vercel
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    VERCEL_URL: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),

    // Database
    POSTGRES_URL: z.url().optional(),

    // App
    APP_URL: z.url().default("http://localhost:3000"),

    // Practice pages on their own hosts (see docs/custom-domains.md).
    // `<slug>.<root>` serves a practice's booking page; unset: no subdomains.
    PRACTICE_ROOT_DOMAIN: z.string().optional(),
    // DNS targets shown to specialists connecting their own domain:
    // CNAME for a subdomain, A record for an apex domain.
    CUSTOM_DOMAIN_CNAME: z.string().optional(),
    CUSTOM_DOMAIN_IP: z.ipv4().optional(),

    // Email
    RESEND_API_KEY: z.string().optional(),
    EMAIL_SANDBOX_ENABLED: z.coerce.boolean().optional().default(false),
    EMAIL_SANDBOX_HOST: z.string().default("localhost"),
    EMAIL_FROM: z.string().default("Acme <onboarding@resend.dev>"),

    // Auth
    AUTH_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    // Comma-separated list of emails granted `adminProcedure` access
    ADMIN_EMAILS: z.string().optional(),
    // Share the session cookie across subdomains, e.g. ".synoro.ru" for
    // app.synoro.ru + synoro.ru. Unset: the cookie stays on the app host.
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    // Comma-separated extra origins allowed to call the auth API and to be
    // redirected to, e.g. "https://synoro.ru". APP_URL is always trusted.
    AUTH_TRUSTED_ORIGINS: z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.union([wildcardOrigin, httpOrigin])))
      .transform((origins) => origins.join(","))
      .optional(),

    // Online payments: encrypts specialists' ЮKassa / Т-Банк keys at rest.
    // Any long random string (openssl rand -base64 32). Unset: specialists
    // can't connect a payment provider. Changing it orphans stored keys.
    PAYMENTS_SECRET_KEY: z.string().min(32).optional(),

    // Hatchet (background jobs). Unset: @synoro/jobs runs work inline.
    HATCHET_CLIENT_TOKEN: z.string().optional(),

    // AWS S3
    AWS_S3_ENDPOINT: z.string().optional(),
    AWS_S3_FORCE_PATH_STYLE: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_REGION: z.string().default("us-east-1"),
    AWS_S3_BUCKET: z.string().default("acme-bucket"),
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().default("Acme Inc."),
    NEXT_PUBLIC_APP_SHORT_NAME: z.string().default("Acme"),
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  },
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
    APP_URL: process.env.APP_URL,
    PRACTICE_ROOT_DOMAIN: process.env.PRACTICE_ROOT_DOMAIN,
    CUSTOM_DOMAIN_CNAME: process.env.CUSTOM_DOMAIN_CNAME,
    CUSTOM_DOMAIN_IP: process.env.CUSTOM_DOMAIN_IP,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_SANDBOX_ENABLED: process.env.EMAIL_SANDBOX_ENABLED === "true",
    EMAIL_SANDBOX_HOST: process.env.EMAIL_SANDBOX_HOST,
    EMAIL_FROM: process.env.EMAIL_FROM,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN,
    AUTH_TRUSTED_ORIGINS: process.env.AUTH_TRUSTED_ORIGINS,
    PAYMENTS_SECRET_KEY: process.env.PAYMENTS_SECRET_KEY,
    HATCHET_CLIENT_TOKEN: process.env.HATCHET_CLIENT_TOKEN,
    AWS_S3_ENDPOINT: process.env.AWS_S3_ENDPOINT,
    AWS_S3_FORCE_PATH_STYLE: process.env.AWS_S3_FORCE_PATH_STYLE,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_SHORT_NAME: process.env.NEXT_PUBLIC_APP_SHORT_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});

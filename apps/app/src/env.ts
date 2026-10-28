import { env as baseEnv } from "@synoro/config";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    PORT: z.coerce.number().default(3000),
  },

  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    /**
     * Optional override for the oRPC API origin. Leave unset to use the
     * built-in Next.js route handler at `/api/orpc` (recommended). Set it to
     * the URL of the standalone `app-server` if you run the API separately.
     */
    NEXT_PUBLIC_API_URL: z.string().url().optional(),
    /** PostHog project key; unset — no analytics. */
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().min(1).optional(),
    /**
     * Ingestion host of the PostHog region (events go through `/ingest`).
     * The default sits in `runtimeEnv`: with `skipValidation` (CI, Docker
     * builds) Zod defaults are not applied.
     */
    NEXT_PUBLIC_POSTHOG_HOST: z.url(),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    NEXT_PUBLIC_POSTHOG_HOST:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
  },
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});

// Re-export base env for convenience
export { baseEnv };

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  client: {
    /** Where this landing is served; canonical URL for metadata. */
    NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3003"),
    /**
     * A live public booking page to show as the demo. Unset: demo links are
     * hidden, so the landing never points at a practice that doesn't exist.
     */
    NEXT_PUBLIC_DEMO_URL: z.url().optional(),
    /** Yandex Metrika counter for ad attribution; unset — no tracking. */
    NEXT_PUBLIC_YANDEX_METRIKA_ID: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    /** PostHog project key; unset — no analytics. */
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().min(1).optional(),
    /** Ingestion host of the PostHog region (events go through `/ingest`). */
    NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://eu.i.posthog.com"),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_DEMO_URL: process.env.NEXT_PUBLIC_DEMO_URL,
    NEXT_PUBLIC_YANDEX_METRIKA_ID: process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});

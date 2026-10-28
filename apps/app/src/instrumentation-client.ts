/**
 * Browser-side instrumentation: Next runs this file before the app hydrates.
 *
 * Events go to our own `/ingest` (rewritten to PostHog in next.config.ts), so
 * ad blockers don't drop them and the CSP needs no PostHog host. Session
 * replay stays off: the cabinet shows clients' names and phone numbers.
 * Unset NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN — nothing is initialised.
 */
import posthog from "posthog-js";

import { env } from "~/env";

if (env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
    api_host: "/ingest",
    ui_host: env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-05-30",
    // Visitors get a profile only after `identify` (signed-in specialists).
    person_profiles: "identified_only",
    disable_session_recording: true,
    respect_dnt: true,
  });
}

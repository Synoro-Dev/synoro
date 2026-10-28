/**
 * Browser-side instrumentation: Next runs this file before the app hydrates.
 *
 * Events go to our own `/ingest` (rewritten to PostHog in next.config.ts), so
 * ad blockers don't drop them. Unset NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN — nothing is
 * initialised. synoro.ru and app.synoro.ru share the visitor's cookie, so a
 * sign-up in the app is attributed to the landing visit.
 */
import posthog from "posthog-js";

import { env } from "~/env";

if (env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
    api_host: "/ingest",
    ui_host: env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-05-30",
    person_profiles: "identified_only",
    disable_session_recording: true,
    respect_dnt: true,
  });

  // The same `data-goal` links the Metrika counter turns into goals.
  document.addEventListener("click", (event) => {
    const goal = (event.target as Element | null)
      ?.closest<HTMLElement>("[data-goal]")
      ?.getAttribute("data-goal");
    if (goal) posthog.capture("landing_goal", { goal });
  });
}

import posthog from "posthog-js";

// `posthog-js` is only initialised when NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is set
// (src/instrumentation-client.ts); before that its methods only warn.

/** Tie the browser's events to a signed-in user. The id only: no email, no name. */
export function identifyUser(userId: string) {
  if (posthog.__loaded) posthog.identify(userId);
}

/** Forget the signed-in user: the next visitor on this browser is anonymous. */
export function resetAnalytics() {
  if (posthog.__loaded) posthog.reset();
}

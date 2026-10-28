import { env, logger } from "@synoro/config";
import { PostHog } from "posthog-node";

/** Events the server reports; the browser's own come from posthog-js. */
type ServerEvent = "booking_reserved" | "payment_succeeded";

let client: PostHog | null | undefined;

function getClient() {
  if (client === undefined) {
    client = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
      ? new PostHog(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
          host: env.NEXT_PUBLIC_POSTHOG_HOST,
          // Few events, long-lived server: send each one right away.
          flushAt: 1,
          flushInterval: 0,
        })
      : null;
  }
  return client;
}

/**
 * Report a product event. Never throws and never waits: analytics must not
 * fail a booking. `distinctId` is a user id — keep names, emails and phones
 * out of `properties`. Unset NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: does nothing.
 */
export function track(
  event: ServerEvent,
  distinctId: string,
  properties: Record<string, string | number | boolean | null> = {},
) {
  try {
    getClient()?.capture({ distinctId, event, properties });
  } catch (error) {
    logger.warn("analytics.capture_failed", {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

import { env, logger } from "@synoro/config";

import {
  manageTochkaWebhook,
  tochkaAvailable,
  tochkaSandbox,
} from "../lib/billing/tochka";

/**
 * `bun billing:webhook <create|show|delete|test> <client_id> [url]`: manage
 * the Точка webhook that tells billing a «Про» payment was made
 * (docs/billing.md). `url` defaults to `${APP_URL}/api/billing/tochka`, which
 * must already be reachable over HTTPS: Точка sends a test notification
 * first and registers nothing unless it answers 200.
 */

const ACTIONS = ["create", "show", "delete", "test"] as const;
type Action = (typeof ACTIONS)[number];

const isAction = (value: string | undefined): value is Action =>
  ACTIONS.some((action) => action === value);

export async function main(args: string[]) {
  const [action, clientId, url] = args;
  if (!isAction(action) || !clientId) {
    logger.error("billing.webhook_usage", undefined, {
      usage: "bun billing:webhook <create|show|delete|test> <client_id> [url]",
    });
    return 1;
  }
  if (tochkaSandbox() || !tochkaAvailable()) {
    logger.error("billing.webhook_unavailable", undefined, {
      reason: tochkaSandbox()
        ? "TOCHKA_SANDBOX: the sandbox has no webhooks"
        : "TOCHKA_API_TOKEN and TOCHKA_CUSTOMER_CODE are not set",
    });
    return 1;
  }

  const target = url ?? new URL("/api/billing/tochka", env.APP_URL).href;
  try {
    const answer = await manageTochkaWebhook(action, clientId, target);
    logger.info("billing.webhook", { action, url: target, answer });
    return 0;
  } catch (error) {
    logger.error("billing.webhook_failed", error, { action, url: target });
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

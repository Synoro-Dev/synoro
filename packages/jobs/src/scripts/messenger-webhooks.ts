import { env } from "@synoro/config";

import { messengerConfigured } from "../messenger/bots";

/**
 * Points the Synoro bots at this deployment: Telegram `setWebhook` and MAX
 * `POST /subscriptions`, each with its webhook secret. Run once per
 * deployment (and after changing APP_URL or a secret):
 *
 *   bun messenger:webhooks
 *
 * A messenger without its settings is skipped. Plain console output: this
 * is a CLI for whoever deploys. Only update kinds the webhooks handle are
 * asked for.
 */

async function telegram(url: string) {
  const response = await fetch(
    `${env.TELEGRAM_API_URL}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "my_chat_member", "callback_query"],
      }),
    },
  );
  const body = (await response.json()) as { ok: boolean; description?: string };
  if (!body.ok) throw new Error(`Telegram: ${body.description}`);
  console.log(`Telegram → ${url}`);
}

async function max(url: string) {
  const response = await fetch(new URL("/subscriptions", env.MAX_API_URL), {
    method: "POST",
    headers: {
      Authorization: env.MAX_BOT_TOKEN ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      update_types: [
        "bot_started",
        "bot_stopped",
        "dialog_removed",
        "message_created",
        "message_callback",
      ],
      secret: env.MAX_WEBHOOK_SECRET,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
  };
  if (!response.ok || !body.success) {
    throw new Error(`MAX: ${response.status} ${body.message ?? ""}`);
  }
  console.log(`MAX → ${url}`);
}

const app = new URL(env.APP_URL);
if (app.protocol !== "https:") {
  console.error(`APP_URL must be https for webhooks, got ${env.APP_URL}`);
  process.exit(1);
}

let failed = false;
for (const [messenger, register] of [
  ["telegram", telegram],
  ["max", max],
] as const) {
  if (!messengerConfigured(messenger)) {
    console.log(`${messenger}: not configured, skipped`);
    continue;
  }
  try {
    await register(new URL(`/api/${messenger}`, app).href);
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : error);
  }
}
process.exit(failed ? 1 : 0);

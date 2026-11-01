import { handleTelegramWebhook } from "@synoro/api";
import { db } from "@synoro/db";

/**
 * Updates of the Synoro Telegram bot (`setWebhook` by
 * `bun messenger:webhooks`), trusted by the `secret_token` header: linking
 * a chat by its start code, blocking and restarting the bot.
 */
export function POST(request: Request) {
  return handleTelegramWebhook(request, db);
}

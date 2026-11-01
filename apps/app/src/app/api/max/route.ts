import { handleMaxWebhook } from "@synoro/api";
import { db } from "@synoro/db";

/**
 * Updates of the Synoro MAX bot (`POST /subscriptions` by
 * `bun messenger:webhooks`), trusted by the `X-Max-Bot-Api-Secret` header:
 * linking a user by the start payload, stopping and restarting the bot.
 */
export function POST(request: Request) {
  return handleMaxWebhook(request, db);
}

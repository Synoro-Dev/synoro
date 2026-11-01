import { env } from "@synoro/config";
import type { Messenger } from "@synoro/validators";

/**
 * The Synoro bots in Telegram (Bot API) and MAX (platform-api2.max.ru):
 * the start link and sending a message. Nothing here touches the database.
 */

/** A notice as a messenger message: plain text and link buttons under it. */
export interface MessengerMessage {
  text: string;
  buttons: { text: string; url: string }[];
}

/**
 * The user blocked or stopped the bot (or never started it): further sends
 * fail the same way, so the chat is marked and notices go by mail.
 */
export class MessengerBlockedError extends Error {
  constructor(messenger: Messenger, detail: string) {
    super(`${messenger}: ${detail}`);
    this.name = "MessengerBlockedError";
  }
}

function settings(messenger: Messenger) {
  return messenger === "telegram"
    ? {
        token: env.TELEGRAM_BOT_TOKEN,
        username: env.TELEGRAM_BOT_USERNAME,
        secret: env.TELEGRAM_WEBHOOK_SECRET,
      }
    : {
        token: env.MAX_BOT_TOKEN,
        username: env.MAX_BOT_USERNAME,
        secret: env.MAX_WEBHOOK_SECRET,
      };
}

/** The bot is set up (token, @name and webhook secret). */
export function messengerConfigured(messenger: Messenger) {
  const { token, username, secret } = settings(messenger);
  return Boolean(token && username && secret);
}

/** The secret the platform sends back with each webhook call. */
export function webhookSecret(messenger: Messenger) {
  return settings(messenger).secret;
}

/** Opens the bot and hands it `code` (Telegram `/start <code>`, MAX `bot_started`). */
export function botLink(messenger: Messenger, code: string) {
  const username = settings(messenger).username?.replace(/^@/, "") ?? "";
  const base =
    messenger === "telegram"
      ? `https://t.me/${username}`
      : `https://max.ru/${username}`;
  return `${base}?start=${encodeURIComponent(code)}`;
}

/**
 * Both messengers take only public https links for buttons: any other link
 * (a local dev address) goes into the text instead.
 */
function split(message: MessengerMessage) {
  const buttons = message.buttons.filter((button) => {
    try {
      const url = new URL(button.url);
      return url.protocol === "https:" && url.hostname !== "localhost";
    } catch {
      return false;
    }
  });
  const inline = message.buttons
    .filter((button) => !buttons.includes(button))
    .map((button) => `${button.text}: ${button.url}`);
  return {
    text: [message.text, ...inline].join("\n\n"),
    buttons,
  };
}

async function sendTelegram(chatId: string, message: MessengerMessage) {
  const { text, buttons } = split(message);
  const response = await fetch(
    `${env.TELEGRAM_API_URL}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
        ...(buttons.length > 0 && {
          reply_markup: {
            inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]),
          },
        }),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as {
    description?: string;
  } | null;
  const detail = `${response.status} ${body?.description ?? ""}`.trim();
  // 403: blocked by the user or deactivated; 400 «chat not found».
  if (
    response.status === 403 ||
    (response.status === 400 && /chat not found/i.test(detail))
  ) {
    throw new MessengerBlockedError("telegram", detail);
  }
  throw new Error(`telegram: ${detail}`);
}

async function sendMax(userId: string, message: MessengerMessage) {
  const { text, buttons } = split(message);
  const url = new URL("/messages", env.MAX_API_URL);
  url.searchParams.set("user_id", userId);
  url.searchParams.set("disable_link_preview", "true");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: env.MAX_BOT_TOKEN ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      ...(buttons.length > 0 && {
        attachments: [
          {
            type: "inline_keyboard",
            payload: {
              buttons: buttons.map((b) => [
                { type: "link", text: b.text, url: b.url },
              ]),
            },
          },
        ],
      }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
  } | null;
  const detail =
    `${response.status} ${body?.code ?? ""} ${body?.message ?? ""}`.trim();
  // MAX documents no code for a stopped bot; it answers 403 or 404 then.
  if (response.status === 403 || response.status === 404) {
    throw new MessengerBlockedError("max", detail);
  }
  throw new Error(`max: ${detail}`);
}

/**
 * Sends `message` to `chatId` (a Telegram chat, a MAX user). Throws
 * `MessengerBlockedError` when the bot can no longer write there.
 */
export function sendToChat(
  messenger: Messenger,
  chatId: string,
  message: MessengerMessage,
) {
  return messenger === "telegram"
    ? sendTelegram(chatId, message)
    : sendMax(chatId, message);
}

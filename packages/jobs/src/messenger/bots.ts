import { env } from "@synoro/config";
import type { Messenger } from "@synoro/validators";

/**
 * The Synoro bots in Telegram (Bot API) and MAX (platform-api2.max.ru):
 * the start link, sending a message and answering a button press. Nothing
 * here touches the database.
 */

/**
 * A button under a message: a link, or an action — a short string the bot's
 * webhook gets back when the button is pressed (`./actions`).
 */
type MessengerButton =
  | { text: string; url: string }
  | { text: string; action: string };

/** A notice as a messenger message: plain text and buttons under it. */
export interface MessengerMessage {
  text: string;
  buttons: MessengerButton[];
}

/** A press of an action button, as the webhook got it. */
export interface MessengerPress {
  /** Telegram `callback_query.id`, MAX `callback.callback_id`. */
  callbackId: string;
  /** The chat the message is in (Telegram chat, MAX user). */
  chatId: string;
  /** The message with the button (Telegram only; MAX answers by callback). */
  messageId: string | null;
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
 * (a local dev address) goes into the text instead. Action buttons stay.
 */
function split(message: MessengerMessage) {
  const buttons = message.buttons.filter((button) => {
    if ("action" in button) return true;
    try {
      const url = new URL(button.url);
      return url.protocol === "https:" && url.hostname !== "localhost";
    } catch {
      return false;
    }
  });
  const inline = message.buttons.flatMap((button) =>
    "url" in button && !buttons.includes(button)
      ? [`${button.text}: ${button.url}`]
      : [],
  );
  return {
    text: [message.text, ...inline].join("\n\n"),
    buttons,
  };
}

/** `message` as the fields of a Telegram `sendMessage` / `editMessageText`. */
function telegramBody(message: MessengerMessage) {
  const { text, buttons } = split(message);
  return {
    text,
    link_preview_options: { is_disabled: true },
    ...(buttons.length > 0 && {
      reply_markup: {
        inline_keyboard: buttons.map((b) => [
          "url" in b
            ? { text: b.text, url: b.url }
            : { text: b.text, callback_data: b.action },
        ]),
      },
    }),
  };
}

/** `message` as a MAX `NewMessageBody`; no buttons clears the old ones. */
function maxBody(message: MessengerMessage) {
  const { text, buttons } = split(message);
  return {
    text,
    attachments:
      buttons.length > 0
        ? [
            {
              type: "inline_keyboard",
              payload: {
                buttons: buttons.map((b) => [
                  "url" in b
                    ? { type: "link", text: b.text, url: b.url }
                    : { type: "callback", text: b.text, payload: b.action },
                ]),
              },
            },
          ]
        : [],
  };
}

/** Calls the Bot API; returns the failure's status and detail, or null. */
async function telegramCall(method: string, body: object) {
  const response = await fetch(
    `${env.TELEGRAM_API_URL}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.ok) return null;
  const answer = (await response.json().catch(() => null)) as {
    description?: string;
  } | null;
  return {
    status: response.status,
    detail: `${response.status} ${answer?.description ?? ""}`.trim(),
  };
}

/** Calls the MAX API; returns the failure's status and detail, or null. */
async function maxCall(
  path: string,
  params: Record<string, string>,
  body: object,
) {
  const url = new URL(path, env.MAX_API_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: env.MAX_BOT_TOKEN ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return null;
  const answer = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
  } | null;
  return {
    status: response.status,
    detail:
      `${response.status} ${answer?.code ?? ""} ${answer?.message ?? ""}`.trim(),
  };
}

async function sendTelegram(chatId: string, message: MessengerMessage) {
  const failed = await telegramCall("sendMessage", {
    chat_id: chatId,
    ...telegramBody(message),
  });
  if (!failed) return;
  // 403: blocked by the user or deactivated; 400 «chat not found».
  if (
    failed.status === 403 ||
    (failed.status === 400 && /chat not found/i.test(failed.detail))
  ) {
    throw new MessengerBlockedError("telegram", failed.detail);
  }
  throw new Error(`telegram: ${failed.detail}`);
}

async function sendMax(userId: string, message: MessengerMessage) {
  const failed = await maxCall(
    "/messages",
    { user_id: userId, disable_link_preview: "true" },
    maxBody(message),
  );
  if (!failed) return;
  // MAX documents no code for a stopped bot; it answers 403 or 404 then.
  if (failed.status === 403 || failed.status === 404) {
    throw new MessengerBlockedError("max", failed.detail);
  }
  throw new Error(`max: ${failed.detail}`);
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

/**
 * Answers a button press: `notice` pops up over the chat (as an alert in
 * Telegram when the message stays as it is), `replace` takes the place of
 * the pressed message, buttons included. Telegram wants every press
 * answered — without it the button keeps spinning.
 */
export async function answerPress(
  messenger: Messenger,
  press: MessengerPress,
  answer: { notice?: string; replace?: MessengerMessage },
) {
  if (messenger === "telegram") {
    const failed = await telegramCall("answerCallbackQuery", {
      callback_query_id: press.callbackId,
      ...(answer.notice && {
        text: answer.notice,
        show_alert: !answer.replace,
      }),
    });
    if (failed) throw new Error(`telegram: ${failed.detail}`);
    if (answer.replace && press.messageId) {
      const edit = await telegramCall("editMessageText", {
        chat_id: press.chatId,
        message_id: Number(press.messageId),
        ...telegramBody(answer.replace),
      });
      if (edit) throw new Error(`telegram: ${edit.detail}`);
    }
    return;
  }
  if (!answer.notice && !answer.replace) return;
  const failed = await maxCall(
    "/answers",
    { callback_id: press.callbackId },
    {
      ...(answer.notice && { notification: answer.notice }),
      ...(answer.replace && { message: maxBody(answer.replace) }),
    },
  );
  if (failed) throw new Error(`max: ${failed.detail}`);
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { logger } from "@synoro/config";
import {
  and,
  type Database,
  eq,
  gt,
  MessengerChat,
  MessengerLinkCode,
  Practice,
  PracticeMember,
  Subscription,
  sql,
} from "@synoro/db";
import {
  botLink,
  messengerConfigured,
  sendToChat,
  webhookSecret,
} from "@synoro/jobs/messenger";
import { MESSENGERS, type Messenger } from "@synoro/validators";

import { track } from "./analytics";

/**
 * Linking a user to the Synoro bot in Telegram or MAX («Про»,
 * docs/reminders.md) and the bots' webhooks. Sending notices is
 * `@synoro/jobs/messenger`.
 */

/** How long a start link works. */
const CODE_TTL_MS = 15 * 60 * 1000;

const hashCode = (code: string) =>
  createHash("sha256").update(code).digest("hex");

/** The messengers whose bot is set up on this deployment. */
export function configuredMessengers(): Messenger[] {
  return MESSENGERS.filter((m) => messengerConfigured(m));
}

/**
 * Messenger notices can reach the user: they are in a practice (any role)
 * whose owner is on «Про» right now. Otherwise everything goes by mail.
 */
export async function messengerAvailable(db: Database, userId: string) {
  const [row] = await db
    .select({ id: Practice.id })
    .from(PracticeMember)
    .innerJoin(Practice, eq(Practice.id, PracticeMember.practiceId))
    .innerJoin(Subscription, eq(Subscription.userId, Practice.ownerId))
    .where(
      and(
        eq(PracticeMember.userId, userId),
        sql`greatest(${Subscription.trialEndsAt}, coalesce(${Subscription.paidUntil}, ${Subscription.trialEndsAt})) > now()`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * A fresh start link for `userId`: 32 hex characters fit both platforms'
 * start parameter (Telegram 64 of `[A-Za-z0-9_-]`, MAX 128). Earlier codes
 * of the user, and everyone's expired ones, are dropped.
 */
export async function createLink(
  db: Database,
  userId: string,
  messenger: Messenger,
) {
  const code = randomBytes(16).toString("hex");
  await db
    .delete(MessengerLinkCode)
    .where(
      sql`${MessengerLinkCode.userId} = ${userId} or ${MessengerLinkCode.expiresAt} < now()`,
    );
  await db.insert(MessengerLinkCode).values({
    codeHash: hashCode(code),
    userId,
    messenger,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return botLink(messenger, code);
}

/**
 * Spend `code` and link its user to `chatId`. False when the code is
 * unknown, expired, used or meant for the other messenger.
 */
async function linkChat(
  db: Database,
  messenger: Messenger,
  code: string,
  chat: { chatId: string; username: string | null },
) {
  const [spent] = await db
    .delete(MessengerLinkCode)
    .where(
      and(
        eq(MessengerLinkCode.codeHash, hashCode(code)),
        eq(MessengerLinkCode.messenger, messenger),
        gt(MessengerLinkCode.expiresAt, new Date()),
      ),
    )
    .returning({ userId: MessengerLinkCode.userId });
  if (!spent) return false;

  const linked = {
    messenger,
    chatId: chat.chatId,
    username: chat.username?.slice(0, 64) ?? null,
    linkedAt: new Date(),
    blockedAt: null,
  };
  await db
    .insert(MessengerChat)
    .values({ userId: spent.userId, ...linked })
    .onConflictDoUpdate({ target: MessengerChat.userId, set: linked });
  track("messenger_linked", spent.userId, { messenger });
  return true;
}

/**
 * The bot was blocked (or stopped) in `chatId`, or allowed again: notices
 * to its users go by mail meanwhile.
 */
async function setBlocked(
  db: Database,
  messenger: Messenger,
  chatId: string,
  blocked: boolean,
) {
  await db
    .update(MessengerChat)
    .set({ blockedAt: blocked ? new Date() : null })
    .where(
      and(
        eq(MessengerChat.messenger, messenger),
        eq(MessengerChat.chatId, chatId),
      ),
    );
}

const REPLIES = {
  linked:
    "Готово! Напоминания о записях и уведомления Synoro будут приходить сюда. Отключить их можно в настройках Synoro.",
  expired:
    "Ссылка устарела или уже использована. Нажмите «Подключить» в Synoro ещё раз.",
  hello:
    "Здесь приходят напоминания о записях Synoro. Чтобы получать их, нажмите «Подключить» в кабинете или в настройках Synoro.",
};

/** The bot's answer; a failure only costs the reply, never the link. */
async function reply(messenger: Messenger, chatId: string, text: string) {
  try {
    await sendToChat(messenger, chatId, { text, buttons: [] });
  } catch (error) {
    logger.warn("messenger.reply_failed", {
      messenger,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Link by `code` and say how it went; no code — explain how to link. */
async function start(
  db: Database,
  messenger: Messenger,
  chat: { chatId: string; username: string | null },
  code: string | null,
) {
  if (!code) {
    await reply(messenger, chat.chatId, REPLIES.hello);
    return;
  }
  const linked = await linkChat(db, messenger, code, chat);
  await reply(
    messenger,
    chat.chatId,
    linked ? REPLIES.linked : REPLIES.expired,
  );
}

/** The platform's secret header matches ours (constant time). */
function trusted(request: Request, header: string, messenger: Messenger) {
  const expected = webhookSecret(messenger);
  const given = request.headers.get(header);
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Runs `handle` for a trusted webhook call. A failure answers 500, so the
 * platform delivers the update again.
 */
async function webhook(
  request: Request,
  messenger: Messenger,
  header: string,
  handle: (update: unknown) => Promise<void>,
) {
  if (!messengerConfigured(messenger)) {
    return new Response(null, { status: 404 });
  }
  if (!trusted(request, header, messenger)) {
    return new Response(null, { status: 401 });
  }
  const update: unknown = await request.json().catch(() => null);
  try {
    await handle(update);
  } catch (error) {
    logger.error("messenger.webhook_failed", error, { messenger });
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: TelegramChat;
    from?: { username?: string };
  };
  my_chat_member?: {
    chat: TelegramChat;
    new_chat_member: { status: string };
  };
}

/**
 * Updates of the Telegram bot (`/api/telegram`, `setWebhook` with
 * `secret_token`): `/start <code>` links the chat, blocking the bot marks
 * it, restarting it clears the mark. Group chats are ignored.
 */
export function handleTelegramWebhook(
  request: Request,
  db: Database,
): Promise<globalThis.Response> {
  return webhook(
    request,
    "telegram",
    "x-telegram-bot-api-secret-token",
    async (raw) => {
      const update = (raw ?? {}) as TelegramUpdate;
      const member = update.my_chat_member;
      if (member?.chat.type === "private") {
        const status = member.new_chat_member.status;
        if (status === "kicked" || status === "member") {
          await setBlocked(
            db,
            "telegram",
            String(member.chat.id),
            status === "kicked",
          );
        }
        return;
      }
      const message = update.message;
      if (message?.chat.type !== "private" || message.text === undefined) {
        return;
      }
      const command = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(message.text);
      await start(
        db,
        "telegram",
        {
          chatId: String(message.chat.id),
          username: message.from?.username ?? null,
        },
        command?.[1] ?? null,
      );
    },
  );
}

interface MaxUpdate {
  update_type?: string;
  user?: { user_id: number; username?: string | null };
  payload?: string | null;
  message?: {
    sender?: { user_id: number };
    recipient?: { chat_type?: string };
  };
}

/**
 * Updates of the MAX bot (`/api/max`, `POST /subscriptions` with `secret`):
 * `bot_started` with the link's payload links the user, `bot_stopped`
 * marks them, a message in the dialog gets the how-to. The bot writes to
 * the MAX user id.
 */
export function handleMaxWebhook(
  request: Request,
  db: Database,
): Promise<globalThis.Response> {
  return webhook(request, "max", "x-max-bot-api-secret", async (raw) => {
    const update = (raw ?? {}) as MaxUpdate;
    switch (update.update_type) {
      case "bot_started": {
        if (!update.user) return;
        const chatId = String(update.user.user_id);
        // Started again from the chat: allowed again, as before.
        if (!update.payload) await setBlocked(db, "max", chatId, false);
        await start(
          db,
          "max",
          { chatId, username: update.user.username ?? null },
          update.payload ?? null,
        );
        return;
      }
      case "bot_stopped":
      case "dialog_removed":
        if (update.user) {
          await setBlocked(db, "max", String(update.user.user_id), true);
        }
        return;
      case "message_created": {
        const sender = update.message?.sender;
        if (sender && update.message?.recipient?.chat_type === "dialog") {
          await reply("max", String(sender.user_id), REPLIES.hello);
        }
        return;
      }
    }
  });
}

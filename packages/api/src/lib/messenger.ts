import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { logger } from "@synoro/config";
import {
  and,
  type Database,
  eq,
  gt,
  lt,
  MessengerChat,
  MessengerLinkCode,
  Practice,
  PracticeMember,
  Subscription,
  sql,
} from "@synoro/db";
import {
  answerPress,
  botLink,
  cancelPrompt,
  type MessengerMessage,
  type MessengerPress,
  messengerConfigured,
  parseAction,
  sendToChat,
  webhookSecret,
} from "@synoro/jobs/messenger";
import { MESSENGERS, type Messenger } from "@synoro/validators";

import { track } from "./analytics";
import { type CancelRefusal, cancelBookingAs, checkCancel } from "./bookings";

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
 * start parameter (Telegram 64 of `[A-Za-z0-9_-]`, MAX 128). It replaces
 * the user's earlier link; everyone's expired ones are dropped.
 */
export async function createLink(
  db: Database,
  userId: string,
  messenger: Messenger,
) {
  const code = randomBytes(16).toString("hex");
  const fresh = {
    codeHash: hashCode(code),
    messenger,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  };
  // One row per user, replaced in one statement: two tabs asking at once
  // leave one working link, never two.
  await db
    .insert(MessengerLinkCode)
    .values({ userId, ...fresh })
    .onConflictDoUpdate({ target: MessengerLinkCode.userId, set: fresh });
  await db
    .delete(MessengerLinkCode)
    .where(lt(MessengerLinkCode.expiresAt, new Date()));
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
  const linked = {
    messenger,
    chatId: chat.chatId,
    username: chat.username?.slice(0, 64) ?? null,
    linkedAt: new Date(),
    blockedAt: null,
  };
  // Spending the code and saving the chat succeed or fail together: a
  // failure in between must not burn the code, the platform retries.
  const userId = await db.transaction(async (tx) => {
    const [spent] = await tx
      .delete(MessengerLinkCode)
      .where(
        and(
          eq(MessengerLinkCode.codeHash, hashCode(code)),
          eq(MessengerLinkCode.messenger, messenger),
          gt(MessengerLinkCode.expiresAt, new Date()),
        ),
      )
      .returning({ userId: MessengerLinkCode.userId });
    if (!spent) return null;
    await tx
      .insert(MessengerChat)
      .values({ userId: spent.userId, ...linked })
      .onConflictDoUpdate({ target: MessengerChat.userId, set: linked });
    return spent.userId;
  });
  if (!userId) return false;
  track("messenger_linked", userId, { messenger });
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

const PRESS_REPLIES = {
  unknown: "Эта кнопка больше не работает. Откройте «Мои записи» в Synoro.",
  unlinked:
    "Этот чат больше не подключён к Synoro. Отменить запись можно в кабинете.",
  cancelled: "Запись отменена.",
  kept: "Хорошо, запись остаётся.",
} as const;

const REFUSALS: Record<CancelRefusal, string> = {
  NOT_FOUND: "Запись уже отменена или не найдена.",
  TOO_LATE:
    "Отменить запись можно не позднее чем за 24 часа до начала — напишите специалисту.",
};

/** A plain text in place of the pressed message, its buttons gone. */
const replaced = (text: string): MessengerMessage => ({ text, buttons: [] });

/**
 * Answers a press; a failure is only logged — what the press did (a
 * cancellation) stands, and a retry of the update must not repeat it.
 */
async function answer(
  messenger: Messenger,
  press: MessengerPress,
  reply: Parameters<typeof answerPress>[2],
) {
  try {
    await answerPress(messenger, press, reply);
  } catch (error) {
    logger.warn("messenger.answer_failed", {
      messenger,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A press of an action button under a notice (`@synoro/jobs/messenger`
 * actions). The chat stands for its linked user, who must be allowed the
 * action like in the cabinet: «Отменить запись» asks «Точно?» in a new
 * message, «Да, отменить» cancels by `cancelBookingAs` and «Нет» keeps it;
 * either answer replaces the question.
 */
async function press(
  db: Database,
  messenger: Messenger,
  pressed: MessengerPress,
  data: string,
) {
  const action = parseAction(data);
  if (!action) {
    await answer(messenger, pressed, { notice: PRESS_REPLIES.unknown });
    return;
  }
  const [chat] = await db
    .select({ userId: MessengerChat.userId })
    .from(MessengerChat)
    .where(
      and(
        eq(MessengerChat.messenger, messenger),
        eq(MessengerChat.chatId, pressed.chatId),
      ),
    );
  if (!chat) {
    await answer(messenger, pressed, { notice: PRESS_REPLIES.unlinked });
    return;
  }

  switch (action.kind) {
    case "keep":
      await answer(messenger, pressed, {
        replace: replaced(PRESS_REPLIES.kept),
      });
      return;
    case "cancel": {
      const check = await checkCancel(db, action.bookingId, chat.userId);
      if ("refusal" in check) {
        await answer(messenger, pressed, { notice: REFUSALS[check.refusal] });
        return;
      }
      const practice = await db.query.Practice.findFirst({
        where: eq(Practice.id, check.booking.practiceId),
        columns: { name: true, timezone: true },
      });
      if (!practice) return;
      await answer(messenger, pressed, {});
      await sendToChat(
        messenger,
        pressed.chatId,
        cancelPrompt({
          ...check.booking,
          practiceName: practice.name,
          timezone: practice.timezone,
        }),
      );
      return;
    }
    case "cancel-confirmed": {
      const result = await cancelBookingAs(db, action.bookingId, chat.userId);
      if ("refusal" in result) {
        await answer(messenger, pressed, {
          replace: replaced(REFUSALS[result.refusal]),
        });
        return;
      }
      track("booking_cancelled_from_messenger", chat.userId, { messenger });
      await answer(messenger, pressed, {
        replace: replaced(PRESS_REPLIES.cancelled),
      });
      return;
    }
  }
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
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: TelegramChat };
    data?: string;
  };
}

/**
 * Updates of the Telegram bot (`/api/telegram`, `setWebhook` with
 * `secret_token`): `/start <code>` links the chat, blocking the bot marks
 * it, restarting it clears the mark, a button press runs its action. Group
 * chats are ignored.
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
      const callback = update.callback_query;
      if (callback) {
        // The bot writes only in private chats, where the chat is the user.
        const chat = callback.message?.chat;
        if (chat && chat.type !== "private") return;
        await press(
          db,
          "telegram",
          {
            callbackId: callback.id,
            chatId: String(chat?.id ?? callback.from.id),
            messageId: callback.message
              ? String(callback.message.message_id)
              : null,
          },
          callback.data ?? "",
        );
        return;
      }
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
  callback?: {
    callback_id: string;
    payload?: string;
    user: { user_id: number };
  };
}

/**
 * Updates of the MAX bot (`/api/max`, `POST /subscriptions` with `secret`):
 * `bot_started` with the link's payload links the user, `bot_stopped`
 * marks them, a message in the dialog gets the how-to, a button press
 * (`message_callback`) runs its action. The bot writes to the MAX user id.
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
      case "message_callback": {
        const callback = update.callback;
        if (!callback) return;
        await press(
          db,
          "max",
          {
            callbackId: callback.callback_id,
            chatId: String(callback.user.user_id),
            messageId: null,
          },
          callback.payload ?? "",
        );
        return;
      }
    }
  });
}

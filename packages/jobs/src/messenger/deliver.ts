import { logger } from "@synoro/config";
import {
  and,
  type Database,
  eq,
  isNull,
  MessengerChat,
  Practice,
  Subscription,
  sql,
} from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import { MESSENGERS, type Messenger } from "@synoro/validators";

import { dispatchEmail, jobsEnabled } from "../index";
import {
  MessengerBlockedError,
  type MessengerMessage,
  messengerConfigured,
  sendToChat,
} from "./bots";
import { messengerMessage } from "./text";

/**
 * Picking the channel of a notice: the recipient's messenger when they
 * linked one and the practice's owner has «Про», mail otherwise. One notice
 * goes one way; a messenger that can't deliver hands it back to mail.
 */

/** Whom a notice is for, and which practice's plan picks the channel. */
export interface Recipient {
  userId: string;
  practiceId: string;
  /**
   * The booking the notice is about, when its client may still cancel it:
   * the messenger message gets «Отменить запись» (the mail doesn't).
   */
  cancelBookingId?: string;
}

/**
 * How a notice leaves: `noticeSender(db)` by default, a recorder in tests.
 * Without `to` it is a plain mail.
 */
export type Deliver = (message: TemplateEmail, to?: Recipient) => Promise<void>;

/** A messenger notice as a task input (JSON); `email` is its fallback. */
export interface MessengerSend {
  userId: string;
  /** The practice whose owner's «Про» lets the notice go by messenger. */
  practiceId: string;
  messenger: Messenger;
  chatId: string;
  message: MessengerMessage;
  email: TemplateEmail;
}

/** The practice's owner is on «Про» right now (same rule as `hasPro`). */
async function ownerHasPro(db: Database, practiceId: string) {
  const [row] = await db
    .select({ id: Practice.id })
    .from(Practice)
    .innerJoin(Subscription, eq(Subscription.userId, Practice.ownerId))
    .where(
      and(
        eq(Practice.id, practiceId),
        sql`greatest(${Subscription.trialEndsAt}, coalesce(${Subscription.paidUntil}, ${Subscription.trialEndsAt})) > now()`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The chat a notice for `to` goes to, or null for mail. */
async function chatFor(db: Database, to: Recipient) {
  // No bot set up (the usual dev setup): don't look anything up.
  if (!MESSENGERS.some((m) => messengerConfigured(m))) return null;
  const [chat] = await db
    .select({
      messenger: MessengerChat.messenger,
      chatId: MessengerChat.chatId,
    })
    .from(MessengerChat)
    .where(
      and(eq(MessengerChat.userId, to.userId), isNull(MessengerChat.blockedAt)),
    );
  if (!chat || !messengerConfigured(chat.messenger)) return null;
  return (await ownerHasPro(db, to.practiceId)) ? chat : null;
}

/**
 * `send` may still go by messenger: the bot is still set up, its chat is
 * still the user's, linked and not blocked, and the practice's owner is
 * still on «Про».
 */
async function stillDeliverable(db: Database, send: MessengerSend) {
  if (!messengerConfigured(send.messenger)) return false;
  const [chat] = await db
    .select({ userId: MessengerChat.userId })
    .from(MessengerChat)
    .where(
      and(
        eq(MessengerChat.userId, send.userId),
        eq(MessengerChat.messenger, send.messenger),
        eq(MessengerChat.chatId, send.chatId),
        isNull(MessengerChat.blockedAt),
      ),
    );
  return chat !== undefined && (await ownerHasPro(db, send.practiceId));
}

/**
 * Sends one messenger notice. A task may wait for its run or a retry: if the
 * user unlinked or switched the chat meanwhile, or the owner's «Про» ended,
 * the mail goes instead. When the bot can't write there any more the chat is
 * marked blocked and the mail goes too; any other failure is thrown for a
 * retry, or — on the last attempt — also turns into the mail.
 */
export async function deliverMessenger(
  db: Database,
  send: MessengerSend,
  options: {
    lastAttempt: boolean;
    sendEmail?: (email: TemplateEmail) => Promise<void>;
  },
) {
  const sendEmail = options.sendEmail ?? dispatchEmail;
  if (!(await stillDeliverable(db, send))) {
    await sendEmail(send.email);
    return;
  }
  try {
    await sendToChat(send.messenger, send.chatId, send.message);
    return;
  } catch (error) {
    const blocked = error instanceof MessengerBlockedError;
    if (!blocked && !options.lastAttempt) throw error;
    logger.warn("messenger.send_failed", {
      messenger: send.messenger,
      template: send.email.template,
      blocked,
      error: error instanceof Error ? error.message : String(error),
    });
    if (blocked) {
      await db
        .update(MessengerChat)
        .set({ blockedAt: new Date() })
        .where(
          and(
            eq(MessengerChat.userId, send.userId),
            eq(MessengerChat.chatId, send.chatId),
          ),
        );
    }
  }
  await sendEmail(send.email);
}

/**
 * Hands the messenger notice to the `send-messenger` task (durable, with
 * retries) when Hatchet is configured; otherwise sends it right away, with
 * the mail as the fallback.
 */
async function dispatchMessenger(
  db: Database,
  send: MessengerSend,
  sendEmail: (email: TemplateEmail) => Promise<void>,
) {
  if (jobsEnabled) {
    try {
      const { sendMessengerTask } = await import("../workflows/send-messenger");
      await sendMessengerTask.runNoWait(send);
      return;
    } catch (error) {
      logger.warn("jobs.enqueue_failed", {
        task: "send-messenger",
        template: send.email.template,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await deliverMessenger(db, send, { lastAttempt: true, sendEmail });
}

/** Sends `email` to `to` by their messenger or by mail (see above). */
export async function dispatchNotice(
  db: Database,
  email: TemplateEmail,
  to?: Recipient,
  sendEmail: (email: TemplateEmail) => Promise<void> = dispatchEmail,
) {
  const message = to ? messengerMessage(email, to) : null;
  const chat = to && message ? await chatFor(db, to) : null;
  if (!to || !message || !chat) {
    await sendEmail(email);
    return;
  }
  await dispatchMessenger(
    db,
    {
      userId: to.userId,
      practiceId: to.practiceId,
      messenger: chat.messenger,
      chatId: chat.chatId,
      message,
      email,
    },
    sendEmail,
  );
}

/**
 * The default `Deliver` of the notice senders. Tests pass `sendEmail` to
 * record mails while the messengers' HTTP is stubbed.
 */
export function noticeSender(
  db: Database,
  sendEmail: (email: TemplateEmail) => Promise<void> = dispatchEmail,
): Deliver {
  return (email, to) => dispatchNotice(db, email, to, sendEmail);
}

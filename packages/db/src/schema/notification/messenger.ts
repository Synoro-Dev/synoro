import { pgEnum, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * Messengers the Synoro bots write in («Про», docs/reminders.md). Keep in
 * sync with `MESSENGERS` in `@synoro/validators`.
 */
export const messenger = pgEnum("messenger", ["telegram", "max"]);

/**
 * Where a user gets notices instead of mail: one messenger per user, linked
 * by opening the bot through a one-time code. Kept apart from `user`, whose
 * schema Better Auth generates.
 */
export const MessengerChat = pgTable("messenger_chats", (t) => ({
  userId: t
    .text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  messenger: messenger().notNull(),
  /**
   * Whom the bot writes to: the Telegram chat id, the MAX user id. Numbers
   * beyond 2^53, so kept as text.
   */
  chatId: t.varchar({ length: 32 }).notNull(),
  /** The user's @name in that messenger, shown in settings. */
  username: t.varchar({ length: 64 }),
  linkedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  /** The user blocked or stopped the bot: notices go by mail meanwhile. */
  blockedAt: t.timestamp({ withTimezone: true }),
}));

/**
 * The one-time code in the bot link (`t.me/<bot>?start=<code>`): only its
 * SHA-256 is kept, it lives 15 minutes and is spent on first use. One per
 * user — a new link replaces the row, so an older link stops working.
 */
export const MessengerLinkCode = pgTable("messenger_link_codes", (t) => ({
  userId: t
    .text()
    .notNull()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  codeHash: t.varchar({ length: 64 }).notNull().unique(),
  messenger: messenger().notNull(),
  expiresAt: t.timestamp({ withTimezone: true }).notNull(),
}));

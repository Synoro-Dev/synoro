import { eq, MessengerChat, Practice } from "@synoro/db";

import { configuredMessengers, messengerAvailable } from "../../lib/messenger";
import { protectedProcedure } from "../../orpc";

/**
 * Where the caller gets notices: the linked messenger, if any, and which
 * ones can be linked. `available` — some practice of theirs has an owner on
 * «Про», so messenger notices reach them; `owner` — they run a practice
 * (and could switch «Про» on themselves).
 *
 * @example client.messenger.status()
 */
export const status = protectedProcedure.handler(async ({ context }) => {
  const userId = context.session.user.id;
  const [chat, available, owned] = await Promise.all([
    context.db.query.MessengerChat.findFirst({
      where: eq(MessengerChat.userId, userId),
      columns: { messenger: true, username: true, blockedAt: true },
    }),
    messengerAvailable(context.db, userId),
    context.db.query.Practice.findFirst({
      where: eq(Practice.ownerId, userId),
      columns: { id: true },
    }),
  ]);
  return {
    messengers: configuredMessengers(),
    available,
    owner: owned !== undefined,
    chat: chat
      ? {
          messenger: chat.messenger,
          username: chat.username,
          blocked: chat.blockedAt !== null,
        }
      : null,
  };
});

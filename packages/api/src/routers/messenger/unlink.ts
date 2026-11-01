import { eq, MessengerChat, MessengerLinkCode } from "@synoro/db";

import { protectedProcedure } from "../../orpc";

/**
 * Stop messenger notices: everything goes by mail again. The chat with the
 * bot stays in the messenger; the bot just stops writing there. A start
 * link not opened yet is revoked too, so it can't link the chat again.
 *
 * @example client.messenger.unlink()
 */
export const unlink = protectedProcedure.handler(async ({ context }) => {
  const userId = context.session.user.id;
  await context.db
    .delete(MessengerLinkCode)
    .where(eq(MessengerLinkCode.userId, userId));
  await context.db
    .delete(MessengerChat)
    .where(eq(MessengerChat.userId, userId));
  return { ok: true };
});

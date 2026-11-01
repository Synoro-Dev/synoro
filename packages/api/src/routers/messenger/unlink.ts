import { eq, MessengerChat } from "@synoro/db";

import { protectedProcedure } from "../../orpc";

/**
 * Stop messenger notices: everything goes by mail again. The chat with the
 * bot stays in the messenger; the bot just stops writing there.
 *
 * @example client.messenger.unlink()
 */
export const unlink = protectedProcedure.handler(async ({ context }) => {
  await context.db
    .delete(MessengerChat)
    .where(eq(MessengerChat.userId, context.session.user.id));
  return { ok: true };
});

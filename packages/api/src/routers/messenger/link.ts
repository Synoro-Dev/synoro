import { MESSENGERS } from "@synoro/validators";
import { z } from "zod";

import {
  configuredMessengers,
  createLink,
  messengerAvailable,
} from "../../lib/messenger";
import { protectedProcedure } from "../../orpc";

/**
 * A start link of the bot: opening it in the messenger links the caller's
 * chat (once, within 15 minutes) and replaces a messenger linked before.
 * Only while some practice of theirs is on «Про».
 *
 * @example client.messenger.link({ messenger: "telegram" })
 */
export const link = protectedProcedure
  .errors({
    NOT_CONFIGURED: { message: "Этот мессенджер пока не подключён к Synoro" },
    PLAN_REQUIRED: {
      message: "Уведомления в мессенджере работают на тарифе «Про»",
    },
  })
  .input(z.object({ messenger: z.enum(MESSENGERS) }))
  .handler(async ({ context, input, errors }) => {
    if (!configuredMessengers().includes(input.messenger)) {
      throw errors.NOT_CONFIGURED();
    }
    const userId = context.session.user.id;
    if (!(await messengerAvailable(context.db, userId))) {
      throw errors.PLAN_REQUIRED();
    }
    return { url: await createLink(context.db, userId, input.messenger) };
  });

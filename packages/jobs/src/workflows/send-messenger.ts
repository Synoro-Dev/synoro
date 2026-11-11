import { db } from "@synoro/db";

import { deliverMessenger, type MessengerSend } from "../messenger/deliver";
import { hatchet } from "./client";

const RETRIES = 4;

/**
 * Sends a notice to a Telegram or MAX chat from the worker, with retries.
 * The last attempt (and a bot the user blocked) falls back to the mail.
 *
 * Enqueued by `dispatchNotice` (`@synoro/jobs/messenger`), which sends
 * inline when Hatchet isn't configured.
 */
export const sendMessengerTask = hatchet.task({
  name: "send-messenger",
  retries: RETRIES,
  backoff: { factor: 2, maxSeconds: 300 },
  executionTimeout: "30s",
  fn: async (rawInput, ctx) => {
    // Hatchet passes all inputs as JsonObject — cast to the expected shape.
    const input = rawInput as unknown as MessengerSend;

    await deliverMessenger(db, input, {
      lastAttempt: ctx.retryCount() >= RETRIES,
    });

    return { messenger: input.messenger, template: input.email.template };
  },
});

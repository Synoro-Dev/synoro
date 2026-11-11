import { logger } from "@synoro/config";

import { cancelAutorenewal } from "../../lib/billing";
import { protectedProcedure } from "../../orpc";

/**
 * Switch off the caller's auto-renewal of «Про»: the card is not charged for
 * the next period. The period already paid for stays. Safe to repeat.
 *
 * @example await client.billing.cancelAutorenew()
 */
export const cancelAutorenew = protectedProcedure.handler(
  async ({ context }) => {
    const { id: userId } = context.session.user;
    const wasOn = await cancelAutorenewal(context.db, userId, "user");
    if (wasOn) logger.info("billing.autorenew_canceled", { userId });
    return { canceled: wasOn };
  },
);

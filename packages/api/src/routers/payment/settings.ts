import { z } from "zod";

import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure, paymentSettings } from "./owner";

/**
 * The connected payment provider (without the secret) and the notification
 * URLs to paste into the provider's dashboard. Owner only.
 *
 * @example client.payment.settings({ practiceId })
 */
export const settings = ownerProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    return paymentSettings(context.db, input.practiceId);
  });

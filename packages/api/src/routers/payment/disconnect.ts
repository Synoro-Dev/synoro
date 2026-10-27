import { eq, PaymentAccount } from "@synoro/db";
import { z } from "zod";

import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure, paymentSettings } from "./owner";

/**
 * Stop taking payments online. The keys stay (inactive) so payments already
 * started can still settle; clients just don't see the top-up anymore.
 *
 * @example client.payment.disconnect({ practiceId })
 */
export const disconnect = ownerProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    await context.db
      .update(PaymentAccount)
      .set({ active: false })
      .where(eq(PaymentAccount.practiceId, input.practiceId));

    return paymentSettings(context.db, input.practiceId);
  });

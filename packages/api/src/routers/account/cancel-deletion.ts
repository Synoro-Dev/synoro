import { AccountDeletion, eq } from "@synoro/db";
import { recordDataAudit } from "@synoro/jobs/data-export";

import { dataProcedure } from "../../lib/data-access";

/**
 * Bring the account back before its term. The practices open again and notices
 * resume. Bookings cancelled at the request stay cancelled, and auto-renewal
 * stays off: both were already acted on, the owner decides anew.
 *
 * @example client.account.cancelDeletion()
 */
export const cancelDeletion = dataProcedure.handler(async ({ context }) => {
  const { user } = context.session;
  const [removed] = await context.db
    .delete(AccountDeletion)
    .where(eq(AccountDeletion.userId, user.id))
    .returning({ userId: AccountDeletion.userId });
  if (removed) {
    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      action: "deletion_cancelled",
    });
  }
  return { restored: removed !== undefined };
});

import { ClientBackup, eq } from "@synoro/db";
import { recordDataAudit } from "@synoro/jobs/data-export";
import { z } from "zod";

import { dataProcedure, hasFreshAccess } from "../../lib/data-access";

/**
 * The weekly copy of the client base. Each mail is a link that needs a sign-in;
 * turning it on still asks for the confirmation, turning off does not.
 *
 * @example client.data.setBackup({ enabled: true })
 */
export const setBackup = dataProcedure
  .input(z.object({ enabled: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const { session, user } = context.session;
    if (input.enabled) {
      if (!(await hasFreshAccess(context.db, session.id))) {
        throw errors.ACCESS_REQUIRED();
      }
      await context.db
        .insert(ClientBackup)
        .values({ userId: user.id })
        .onConflictDoNothing();
    } else {
      await context.db
        .delete(ClientBackup)
        .where(eq(ClientBackup.userId, user.id));
    }
    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      action: input.enabled ? "backup_enabled" : "backup_disabled",
    });
    return { enabled: input.enabled };
  });

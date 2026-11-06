import { CalendarFeed, eq } from "@synoro/db";
import { recordDataAudit } from "@synoro/jobs/data-export";
import { z } from "zod";

import { dataProcedure, findOwnedPractice } from "../../lib/data-access";

/**
 * Turn the feed off: its link stops working. Needs no confirmation, it gives
 * nothing away.
 *
 * @example client.data.disableFeed({ practiceId })
 */
export const disableFeed = dataProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const practice = await findOwnedPractice(
      context.db,
      input.practiceId,
      user.id,
    );
    if (!practice) throw errors.FORBIDDEN();

    await context.db
      .delete(CalendarFeed)
      .where(eq(CalendarFeed.practiceId, practice.id));
    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      practiceId: practice.id,
      action: "feed_disabled",
    });
    return { disabled: true };
  });

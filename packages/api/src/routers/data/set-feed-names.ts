import { CalendarFeed, eq } from "@synoro/db";
import { z } from "zod";

import {
  dataProcedure,
  findOwnedPractice,
  hasFreshAccess,
} from "../../lib/data-access";

/**
 * Whether the feed's events name clients. Turning names on sends them to the
 * calendar's provider, so it asks for the confirmation; turning off does not.
 *
 * @example client.data.setFeedNames({ practiceId, showNames: false })
 */
export const setFeedNames = dataProcedure
  .input(z.object({ practiceId: z.uuid(), showNames: z.boolean() }))
  .handler(async ({ context, input, errors }) => {
    const { session, user } = context.session;
    const practice = await findOwnedPractice(
      context.db,
      input.practiceId,
      user.id,
    );
    if (!practice) throw errors.FORBIDDEN();
    if (input.showNames && !(await hasFreshAccess(context.db, session.id))) {
      throw errors.ACCESS_REQUIRED();
    }

    await context.db
      .update(CalendarFeed)
      .set({ showNames: input.showNames })
      .where(eq(CalendarFeed.practiceId, practice.id));
    return { showNames: input.showNames };
  });

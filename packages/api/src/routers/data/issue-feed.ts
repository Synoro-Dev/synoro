import { CalendarFeed } from "@synoro/db";
import { recordDataAudit } from "@synoro/jobs/data-export";
import { z } from "zod";

import {
  dataProcedure,
  findOwnedPractice,
  hasFreshAccess,
} from "../../lib/data-access";
import { feedUrl, hashFeedToken, newFeedToken } from "../../lib/data-files";

/**
 * Turn the calendar feed on, or reissue its secret link: the old one stops
 * working at once. Only the hash is kept, so this is the only time the link
 * is seen.
 *
 * @example client.data.issueFeed({ practiceId })
 */
export const issueFeed = dataProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { session, user } = context.session;
    const practice = await findOwnedPractice(
      context.db,
      input.practiceId,
      user.id,
    );
    if (!practice) throw errors.FORBIDDEN();
    if (!(await hasFreshAccess(context.db, session.id))) {
      throw errors.ACCESS_REQUIRED();
    }

    const token = newFeedToken();
    const tokenHash = hashFeedToken(token);
    const [row] = await context.db
      .insert(CalendarFeed)
      .values({ practiceId: practice.id, tokenHash })
      .onConflictDoUpdate({
        target: CalendarFeed.practiceId,
        set: { tokenHash, rotatedAt: new Date(), lastFetchedAt: null },
      })
      .returning({ rotatedAt: CalendarFeed.rotatedAt });

    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      practiceId: practice.id,
      action: row?.rotatedAt ? "feed_rotated" : "feed_enabled",
    });
    return { url: feedUrl(token) };
  });

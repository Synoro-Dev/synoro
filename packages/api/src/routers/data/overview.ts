import { accountHasPassword } from "@synoro/auth/password";
import { asc, CalendarFeed, ClientBackup, eq, Practice } from "@synoro/db";

import { dataProcedure, hasFreshAccess } from "../../lib/data-access";

/**
 * What the data settings page shows: the caller's practices with their feeds,
 * the weekly copy, and whether access is confirmed right now.
 *
 * @example client.data.overview()
 */
export const overview = dataProcedure.handler(async ({ context }) => {
  const userId = context.session.user.id;
  const [practices, backup, fresh, hasPassword] = await Promise.all([
    context.db
      .select({
        id: Practice.id,
        name: Practice.name,
        showNames: CalendarFeed.showNames,
        feedCreatedAt: CalendarFeed.createdAt,
        lastFetchedAt: CalendarFeed.lastFetchedAt,
      })
      .from(Practice)
      .leftJoin(CalendarFeed, eq(CalendarFeed.practiceId, Practice.id))
      .where(eq(Practice.ownerId, userId))
      .orderBy(asc(Practice.createdAt)),
    context.db.query.ClientBackup.findFirst({
      where: eq(ClientBackup.userId, userId),
      columns: { userId: true },
    }),
    hasFreshAccess(context.db, context.session.session.id),
    accountHasPassword(context.db, userId),
  ]);

  return {
    email: context.session.user.email,
    practices: practices.map((practice) => ({
      id: practice.id,
      name: practice.name,
      feed: practice.feedCreatedAt
        ? {
            showNames: practice.showNames ?? false,
            lastFetchedAt: practice.lastFetchedAt,
          }
        : null,
    })),
    backup: backup !== undefined,
    access: { fresh, hasPassword },
  };
});

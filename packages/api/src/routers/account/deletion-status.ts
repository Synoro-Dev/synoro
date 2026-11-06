import {
  AccountDeletion,
  and,
  asc,
  Booking,
  eq,
  gt,
  ne,
  Practice,
  PracticeMember,
} from "@synoro/db";
import { DELETION_GRACE_DAYS } from "@synoro/jobs/account-deletion";

import { dataProcedure } from "../../lib/data-access";

/**
 * Whether the account is being deleted, and what would go with it if asked now:
 * per practice, clients, upcoming bookings, those of them that can't be mailed,
 * and consultations clients have paid for and not used.
 *
 * @example client.account.deletionStatus()
 */
export const deletionStatus = dataProcedure.handler(async ({ context }) => {
  const userId = context.session.user.id;
  const now = new Date();
  const [pending, practices] = await Promise.all([
    context.db.query.AccountDeletion.findFirst({
      where: eq(AccountDeletion.userId, userId),
    }),
    context.db
      .select({ id: Practice.id, name: Practice.name })
      .from(Practice)
      .where(eq(Practice.ownerId, userId))
      .orderBy(asc(Practice.createdAt)),
  ]);

  const counts = await Promise.all(
    practices.map(async (practice) => {
      const [clients, upcoming] = await Promise.all([
        context.db
          .select({ credits: PracticeMember.credits })
          .from(PracticeMember)
          .where(
            and(
              eq(PracticeMember.practiceId, practice.id),
              eq(PracticeMember.role, "client"),
            ),
          ),
        context.db
          .select({ memberId: Booking.memberId })
          .from(Booking)
          .where(
            and(
              eq(Booking.practiceId, practice.id),
              eq(Booking.status, "active"),
              gt(Booking.startsAt, now),
              ne(Booking.kind, "blocked"),
            ),
          ),
      ]);
      return { clients, upcoming };
    }),
  );

  return {
    graceDays: DELETION_GRACE_DAYS,
    pending: pending
      ? { requestedAt: pending.requestedAt, purgeAt: pending.purgeAt }
      : null,
    practices: practices.map((practice, index) => {
      const { clients = [], upcoming = [] } = counts[index] ?? {};
      return {
        ...practice,
        clients: clients.length,
        paidCredits: clients.reduce((sum, row) => sum + row.credits, 0),
        upcoming: upcoming.length,
        upcomingGuests: upcoming.filter((row) => row.memberId === null).length,
      };
    }),
  };
});

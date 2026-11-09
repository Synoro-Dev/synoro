import {
  and,
  Booking,
  desc,
  eq,
  gte,
  OfflinePayment,
  PracticeMember,
  sql,
  user,
} from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The practice's last 100 payments received outside Synoro, newest first,
 * with the client, the booking or package they paid for, and the total of the
 * last 30 days — staff only.
 *
 * @example client.offlinePayment.list({ practiceId })
 */
export const list = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    const [payments, [month]] = await Promise.all([
      context.db
        .select({
          id: OfflinePayment.id,
          amount: OfflinePayment.amount,
          method: OfflinePayment.method,
          paidAt: OfflinePayment.paidAt,
          note: OfflinePayment.note,
          clientName: user.name,
          /** The booking it paid for, when paid at the visit. */
          bookingStartsAt: Booking.startsAt,
          /** The credits of a package credited with it. */
          credits: OfflinePayment.credits,
        })
        .from(OfflinePayment)
        .leftJoin(
          PracticeMember,
          eq(PracticeMember.id, OfflinePayment.memberId),
        )
        .leftJoin(user, eq(user.id, PracticeMember.userId))
        .leftJoin(Booking, eq(Booking.id, OfflinePayment.bookingId))
        .where(eq(OfflinePayment.practiceId, input.practiceId))
        .orderBy(desc(OfflinePayment.paidAt), desc(OfflinePayment.createdAt))
        .limit(100),
      context.db
        .select({
          // A bigint: a month of a busy centre may pass 2^31 kopecks.
          amount:
            sql<number>`coalesce(sum(${OfflinePayment.amount}), 0)`.mapWith(
              Number,
            ),
          count: sql<number>`count(*)::int`,
        })
        .from(OfflinePayment)
        .where(
          and(
            eq(OfflinePayment.practiceId, input.practiceId),
            gte(OfflinePayment.paidAt, new Date(Date.now() - MONTH_MS)),
          ),
        ),
    ]);

    return { payments, month: month ?? { amount: 0, count: 0 } };
  });

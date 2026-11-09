import {
  and,
  asc,
  Booking,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  notExists,
  OfflinePayment,
  PracticeMember,
  Service,
  user,
} from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/** How far back «Ждут оплаты» looks. */
const UNPAID_DAYS = 90;

/**
 * «Ждут оплаты»: bookings paid at the visit (a client's consultation that
 * took nothing from the balance, `credits` 0) that ended within the last 90
 * days, weren't cancelled and have no payment written down — staff only.
 * Oldest first. Imported bookings, with no account behind them, aren't here.
 *
 * @example client.offlinePayment.unpaid({ practiceId })
 */
export const unpaid = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    const staff = await findStaffMembership(
      db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    const now = new Date();
    return db
      .select({
        id: Booking.id,
        startsAt: Booking.startsAt,
        endsAt: Booking.endsAt,
        memberId: Booking.memberId,
        clientName: user.name,
        serviceName: Service.name,
      })
      .from(Booking)
      .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
      .innerJoin(user, eq(user.id, PracticeMember.userId))
      .leftJoin(Service, eq(Service.id, Booking.serviceId))
      .where(
        and(
          eq(Booking.practiceId, input.practiceId),
          eq(Booking.kind, "consultation"),
          eq(Booking.credits, 0),
          eq(Booking.status, "active"),
          isNull(Booking.holdUntil),
          isNotNull(Booking.memberId),
          lte(Booking.endsAt, now),
          gte(
            Booking.endsAt,
            new Date(now.getTime() - UNPAID_DAYS * 24 * 60 * 60 * 1000),
          ),
          notExists(
            db
              .select({ id: OfflinePayment.id })
              .from(OfflinePayment)
              .where(eq(OfflinePayment.bookingId, Booking.id)),
          ),
        ),
      )
      .orderBy(asc(Booking.startsAt));
  });

import { asc, Booking, eq, PracticeMember, user } from "@acme/db";
import { z } from "zod";

import { activeBookingOverlaps, localDaysRange } from "../../lib/bookings";
import {
  findPractice,
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Active bookings, free consultations and blocks for `days` local days from
 * `from`, with the client's name — staff only.
 *
 * @example client.booking.calendar({ practiceId, from: "2026-11-02", days: 7 })
 */
export const calendar = practiceProcedure
  .input(
    z.object({
      practiceId: z.uuid(),
      from: z.iso.date(),
      days: z.number().int().min(1).max(31).default(7),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const [staff, practice] = await Promise.all([
      findStaffMembership(
        context.db,
        input.practiceId,
        context.session.user.id,
      ),
      findPractice(context.db, input.practiceId),
    ]);
    if (!staff || !practice) throw errors.FORBIDDEN();

    const { start, end } = localDaysRange(
      input.from,
      input.days,
      practice.timezone,
    );

    return context.db
      .select({
        id: Booking.id,
        kind: Booking.kind,
        startsAt: Booking.startsAt,
        endsAt: Booking.endsAt,
        note: Booking.note,
        guestName: Booking.guestName,
        guestContact: Booking.guestContact,
        memberId: Booking.memberId,
        clientName: user.name,
        clientEmail: user.email,
      })
      .from(Booking)
      .leftJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
      .leftJoin(user, eq(user.id, PracticeMember.userId))
      .where(activeBookingOverlaps(practice.id, start, end))
      .orderBy(asc(Booking.startsAt));
  });

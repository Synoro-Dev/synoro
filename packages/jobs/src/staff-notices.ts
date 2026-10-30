import { env, logger, paths } from "@synoro/config";
import {
  alias,
  and,
  Booking,
  type Database,
  eq,
  inArray,
  ne,
  Practice,
  PracticeMember,
  user,
} from "@synoro/db";
import type { StaffBookingNotice } from "@synoro/emails";

import type { Deliver } from "./booking-video";
import { dispatchEmail } from "./index";
import { describeDates } from "./when";

/**
 * Telling the specialist and the administrators of a practice that a booking
 * was made or cancelled. The one who did it is not told. Event-driven: the
 * callers act once per booking (a conditional insert or update), so nothing
 * here needs deduplicating. Best effort — a mail failure is logged and never
 * undoes the booking.
 */

const client = alias(user, "client");

/**
 * Mail the staff about `bookingId`. A series passes the dates of all its
 * bookings in `dates` (the booking is one of them) and gets one mail.
 */
export async function notifyStaff(
  db: Database,
  bookingId: string,
  notice: StaffBookingNotice,
  options: { refunded?: boolean; dates?: Date[] } = {},
  deliver: Deliver = dispatchEmail,
) {
  try {
    const [row] = await db
      .select({
        practiceId: Booking.practiceId,
        kind: Booking.kind,
        startsAt: Booking.startsAt,
        guestName: Booking.guestName,
        guestPhone: Booking.guestPhone,
        createdById: Booking.createdById,
        cancelledById: Booking.cancelledById,
        cancelReason: Booking.cancelReason,
        status: Booking.status,
        holdUntil: Booking.holdUntil,
        practiceName: Practice.name,
        timezone: Practice.timezone,
        clientName: client.name,
        clientPhone: client.phone,
      })
      .from(Booking)
      .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
      .leftJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
      .leftJoin(client, eq(client.id, PracticeMember.userId))
      .where(eq(Booking.id, bookingId));
    // An unpaid hold is not a booking yet, and its lapse is nobody's news.
    if (!row || row.kind === "blocked" || row.holdUntil !== null) return;
    if (notice === "booked" && row.status !== "active") return;

    const actorId = notice === "booked" ? row.createdById : row.cancelledById;
    const staff = await db
      .select({ email: user.email })
      .from(PracticeMember)
      .innerJoin(user, eq(user.id, PracticeMember.userId))
      .where(
        and(
          eq(PracticeMember.practiceId, row.practiceId),
          inArray(PracticeMember.role, ["owner", "admin"]),
          actorId ? ne(PracticeMember.userId, actorId) : undefined,
        ),
      );
    if (staff.length === 0) return;

    const clientName = row.clientName ?? row.guestName ?? "Клиент";
    const { when, dates } = describeDates(
      options.dates ?? [row.startsAt],
      row.timezone,
    );
    const calendarUrl = new URL(
      paths.booking.calendar(row.practiceId),
      env.APP_URL,
    ).href;
    const subject =
      notice === "booked"
        ? `Новая запись: ${clientName}, ${when}`
        : `Запись отменена: ${clientName}, ${when}`;

    await Promise.all(
      staff.map(async ({ email }) => {
        try {
          await deliver({
            template: "staff-booking",
            to: [email],
            subject,
            props: {
              notice,
              practiceName: row.practiceName,
              clientName,
              clientPhone: row.clientPhone ?? row.guestPhone,
              when,
              free: row.kind === "free",
              cancelledBy:
                row.cancelReason === "client"
                  ? "client"
                  : row.cancelReason === "staff"
                    ? "staff"
                    : null,
              refunded: options.refunded ?? false,
              calendarUrl,
              dates,
            },
          });
        } catch (error) {
          logger.warn("booking.staff_notice_failed", {
            bookingId,
            notice,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  } catch (error) {
    logger.warn("booking.staff_notice_failed", {
      bookingId,
      notice,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

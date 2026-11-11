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

import { type Deliver, noticeSender } from "./messenger/deliver";
import { describeDates } from "./when";

/**
 * Telling the specialist and the administrators of a practice that a booking
 * was made, moved or cancelled, unless the practice turned it off
 * (`practices.notify_staff`). The one who did it is not told. Event-driven: the
 * callers act once per booking (a conditional insert or update), so nothing
 * here needs deduplicating. Best effort — a mail failure is logged and never
 * undoes the booking.
 */

const client = alias(user, "client");

/**
 * Mail the staff about `bookingId`. A series passes the dates of all its
 * bookings in `dates` (the booking is one of them) and gets one mail. A move
 * passes the old time in `from` and who moved it in `actorId`.
 */
export async function notifyStaff(
  db: Database,
  bookingId: string,
  notice: StaffBookingNotice,
  options: {
    refunded?: boolean;
    dates?: Date[];
    from?: Date;
    actorId?: string;
  } = {},
  deliver: Deliver = noticeSender(db),
) {
  try {
    const [row] = await db
      .select({
        practiceId: Booking.practiceId,
        kind: Booking.kind,
        credits: Booking.credits,
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
        notifyStaff: Practice.notifyStaff,
        clientId: client.id,
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
    if (notice !== "cancelled" && row.status !== "active") return;
    if (!row.notifyStaff) return;

    const actorId =
      options.actorId ??
      (notice === "booked" ? row.createdById : row.cancelledById);
    const staff = await db
      .select({ userId: user.id, email: user.email })
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
    const titles = {
      booked: "Новая запись",
      moved: "Запись перенесена",
      cancelled: "Запись отменена",
    };
    const subject = `${titles[notice]}: ${clientName}, ${when}`;

    await Promise.all(
      staff.map(async ({ userId, email }) => {
        try {
          await deliver(
            {
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
                charged: row.credits > 0,
                cancelledBy:
                  row.cancelReason === "client" ||
                  row.cancelReason === "late_cancel"
                    ? "client"
                    : row.cancelReason === "staff"
                      ? "staff"
                      : null,
                refunded: options.refunded ?? false,
                movedFrom: options.from
                  ? describeDates([options.from], row.timezone).when
                  : null,
                movedBy:
                  notice === "moved"
                    ? options.actorId === row.clientId
                      ? "client"
                      : "staff"
                    : null,
                calendarUrl,
                dates,
              },
            },
            { userId, practiceId: row.practiceId },
          );
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

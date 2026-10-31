import { logger } from "@synoro/config";
import {
  and,
  asc,
  Booking,
  type Database,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  Practice,
  PracticeMember,
  user,
} from "@synoro/db";
import type { BookingNotice, TemplateEmail } from "@synoro/emails";

import { dispatchEmail } from "./index";
import { notifyStaff } from "./staff-notices";
import { cabinetUrl } from "./urls";
import { describeDates, localHour } from "./when";

/**
 * Telling a client about their booking: the confirmation, the video link when
 * the specialist sets or changes it, reminders and cancellation — and the
 * practice's staff about bookings made and cancelled (`./staff-notices`).
 * Everything here is best effort — a mail failure is logged and never undoes
 * a booking or a save.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Maximum number of bookings fetched per batch. */
const MAX_NOTICES = 200;
/** Day reminders reach clients from 9:00 to 22:00, practice time. */
const DAY_HOURS = { from: 9, until: 22 };

type Notice = BookingNotice;

/** How a mail leaves: `dispatchEmail` by default, a recorder in tests. */
export type Deliver = (message: TemplateEmail) => Promise<void>;

/** Paid bookings of clients who can be mailed. */
function confirmedBookings(db: Database) {
  return db
    .select({
      id: Booking.id,
      startsAt: Booking.startsAt,
      meetingUrl: Booking.meetingUrl,
      reminderDaySentAt: Booking.reminderDaySentAt,
      reminderHourSentAt: Booking.reminderHourSentAt,
      videoUrl: Practice.videoUrl,
      practiceName: Practice.name,
      timezone: Practice.timezone,
      clientName: user.name,
      clientEmail: user.email,
    })
    .from(Booking)
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(user, eq(user.id, PracticeMember.userId));
}

type Row = Awaited<ReturnType<typeof confirmedBookings>>[number];

async function send(
  deliver: Deliver,
  row: Row,
  notice: Notice,
  cancellation?: { by: "client" | "specialist"; refunded: boolean },
  series?: Date[],
) {
  const { when, dates } = describeDates(series ?? [row.startsAt], row.timezone);
  const videoUrl =
    notice === "cancelled" ? null : (row.meetingUrl ?? row.videoUrl);
  const subjects: Record<Notice, string> = {
    confirmed: `Запись подтверждена: ${row.practiceName}`,
    link: `Ссылка на видеовстречу: ${row.practiceName}`,
    "reminder-day": `Напоминание: встреча завтра — ${row.practiceName}`,
    "reminder-hour": `Напоминание: встреча через час — ${row.practiceName}`,
    cancelled: `Запись отменена: ${row.practiceName}`,
  };
  await deliver({
    template: "booking-notice",
    to: [row.clientEmail],
    subject: subjects[notice],
    props: {
      notice,
      name: row.clientName,
      practiceName: row.practiceName,
      when,
      dates,
      videoUrl,
      cabinetUrl: cabinetUrl(),
      cancelledBy: cancellation?.by ?? null,
      refunded: cancellation?.refunded ?? false,
    },
  });
}

/**
 * A mail that carries the link covers the reminders already due: without
 * this the client would get the same link again at the next worker tick.
 */
async function markDueReminders(db: Database, row: Row) {
  const left = row.startsAt.getTime() - Date.now();
  const now = new Date();
  await db
    .update(Booking)
    .set({
      reminderDaySentAt: left <= DAY_MS ? (row.reminderDaySentAt ?? now) : null,
      reminderHourSentAt:
        left <= HOUR_MS ? (row.reminderHourSentAt ?? now) : null,
    })
    .where(eq(Booking.id, row.id));
}

function settled(bookingId: string, notice: Notice, error: unknown) {
  logger.warn("booking.video_notice_failed", {
    bookingId,
    notice,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * After payment (or a credit) confirmed a booking, or staff booked a guest:
 * tell the client (a paid booking only) and the practice's staff.
 */
export async function notifyBookingConfirmed(
  db: Database,
  bookingId: string,
  deliver: Deliver = dispatchEmail,
) {
  try {
    const [row] = await confirmedBookings(db).where(
      and(
        eq(Booking.id, bookingId),
        eq(Booking.kind, "consultation"),
        eq(Booking.status, "active"),
        isNull(Booking.holdUntil),
      ),
    );
    if (row) {
      await send(deliver, row, "confirmed");
      // The confirmation names the time: reminders already due are covered.
      await markDueReminders(db, row);
    }
  } catch (error) {
    settled(bookingId, "confirmed", error);
  }
  await notifyStaff(db, bookingId, "booked", {}, deliver);
}

/**
 * After the client or staff cancelled a booking: tell the client and the
 * practice's staff (but not the one who cancelled). A no-show mark and an
 * unpaid hold that lapsed are nobody's news.
 */
export async function notifyBookingCancelled(
  db: Database,
  bookingId: string,
  options: { refunded: boolean },
  deliver: Deliver = dispatchEmail,
) {
  try {
    const [booking] = await db
      .select({ cancelReason: Booking.cancelReason })
      .from(Booking)
      .where(eq(Booking.id, bookingId));
    const by = booking?.cancelReason;
    if (by !== "client" && by !== "staff") return;

    const [row] = await confirmedBookings(db).where(
      and(
        eq(Booking.id, bookingId),
        eq(Booking.kind, "consultation"),
        isNull(Booking.holdUntil),
        gt(Booking.startsAt, new Date()),
      ),
    );
    if (row) {
      await send(deliver, row, "cancelled", {
        by: by === "client" ? "client" : "specialist",
        refunded: options.refunded,
      });
    }
  } catch (error) {
    settled(bookingId, "cancelled", error);
  }
  // Staff are told even when the client's mail failed.
  await notifyStaff(db, bookingId, "cancelled", options, deliver);
}

/**
 * Start times of `bookingIds`, earliest first; the first id with it. A mail
 * never undoes a saved booking, so a failed lookup is logged and gives
 * undefined.
 */
async function seriesDates(db: Database, bookingIds: string[], notice: Notice) {
  try {
    const rows = await db
      .select({ id: Booking.id, startsAt: Booking.startsAt })
      .from(Booking)
      .where(inArray(Booking.id, bookingIds))
      .orderBy(asc(Booking.startsAt));
    const firstId = rows[0]?.id;
    return firstId
      ? { firstId, dates: rows.map((r) => r.startsAt) }
      : undefined;
  } catch (error) {
    settled(bookingIds.join(","), notice, error);
    return undefined;
  }
}

/**
 * After a recurring booking was made: one mail to the client and one to the
 * staff with all its dates, instead of one per booking.
 */
export async function notifySeriesBooked(
  db: Database,
  bookingIds: string[],
  deliver: Deliver = dispatchEmail,
) {
  const found = await seriesDates(db, bookingIds, "confirmed");
  if (!found) return;
  const { firstId, dates } = found;
  try {
    const [row] = await confirmedBookings(db).where(eq(Booking.id, firstId));
    if (row) {
      await send(deliver, row, "confirmed", undefined, dates);
      // The first booking may already be within a day: it is covered.
      await markDueReminders(db, row);
    }
  } catch (error) {
    settled(firstId, "confirmed", error);
  }
  await notifyStaff(db, firstId, "booked", { dates }, deliver);
}

/**
 * After the upcoming bookings of a series were cancelled together: one mail
 * to the client and one to the staff (but not the one who cancelled).
 */
export async function notifySeriesCancelled(
  db: Database,
  bookingIds: string[],
  options: { by: "client" | "staff"; refunded: boolean },
  deliver: Deliver = dispatchEmail,
) {
  const found = await seriesDates(db, bookingIds, "cancelled");
  if (!found) return;
  const { firstId, dates } = found;
  try {
    const [row] = await confirmedBookings(db).where(eq(Booking.id, firstId));
    if (row) {
      await send(
        deliver,
        row,
        "cancelled",
        {
          by: options.by === "client" ? "client" : "specialist",
          refunded: options.refunded,
        },
        dates,
      );
    }
  } catch (error) {
    settled(firstId, "cancelled", error);
  }
  await notifyStaff(
    db,
    firstId,
    "cancelled",
    { refunded: options.refunded, dates },
    deliver,
  );
}

/**
 * The link of upcoming confirmed bookings changed: tell their clients. Pass
 * booking ids, or `practiceId` to take every upcoming booking of the practice
 * that has no link of its own (the ones the practice's room applies to).
 * Nothing is sent when no link is left.
 */
export async function notifyVideoLinkChanged(
  db: Database,
  scope: { bookingId: string } | { practiceId: string },
  deliver: Deliver = dispatchEmail,
) {
  try {
    const upcoming = and(
      eq(Booking.kind, "consultation"),
      eq(Booking.status, "active"),
      isNull(Booking.holdUntil),
      gt(Booking.startsAt, new Date()),
    );
    let afterId: string | undefined;
    while (true) {
      const rows = await confirmedBookings(db)
        .where(
          and(
            "bookingId" in scope
              ? and(upcoming, eq(Booking.id, scope.bookingId))
              : and(
                  upcoming,
                  eq(Booking.practiceId, scope.practiceId),
                  isNull(Booking.meetingUrl),
                ),
            afterId ? gt(Booking.id, afterId) : undefined,
          ),
        )
        .orderBy(Booking.id)
        .limit(MAX_NOTICES);

      await Promise.all(
        rows
          .filter((row) => row.meetingUrl ?? row.videoUrl)
          .map(async (row) => {
            try {
              await send(deliver, row, "link");
              await markDueReminders(db, row);
            } catch (error) {
              settled(row.id, "link", error);
            }
          }),
      );

      const last = rows.at(-1);
      if (!last || rows.length < MAX_NOTICES) break;
      afterId = last.id;
    }
  } catch (error) {
    logger.warn("booking.video_notice_failed", {
      notice: "link",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Reminders, with the video link when there is one: once when the meeting is
 * within a day, once when it is within the hour. The day reminder waits for
 * the practice's daytime (9:00–22:00); the hour reminder goes at once. A
 * reminder is claimed in the database before it is sent, so two workers (or
 * a retry) never send it twice; a failed send gives the claim back.
 */
export async function sendBookingReminders(
  db: Database,
  deliver: Deliver = dispatchEmail,
  at = new Date(),
) {
  const now = at.getTime();
  const windows = [
    {
      notice: "reminder-day",
      pending: isNull(Booking.reminderDaySentAt),
      // Within the hour the hour reminder takes over.
      from: new Date(now + HOUR_MS),
      until: new Date(now + DAY_MS),
      claim: () => ({ reminderDaySentAt: new Date() }),
      release: { reminderDaySentAt: null },
    },
    {
      notice: "reminder-hour",
      pending: isNull(Booking.reminderHourSentAt),
      from: new Date(now),
      until: new Date(now + HOUR_MS),
      // The hour reminder also covers the day one it overtook.
      claim: () => ({
        reminderHourSentAt: new Date(),
        reminderDaySentAt: new Date(),
      }),
      release: { reminderHourSentAt: null },
    },
  ] as const;

  for (const window of windows) {
    // Page by id: bookings skipped for the night stay pending, and must not
    // fill the batch ahead of the ones that are due now.
    let afterId: string | undefined;
    while (true) {
      const due = await confirmedBookings(db)
        .where(
          and(
            eq(Booking.kind, "consultation"),
            eq(Booking.status, "active"),
            isNull(Booking.holdUntil),
            window.pending,
            gt(Booking.startsAt, window.from),
            lte(Booking.startsAt, window.until),
            afterId ? gt(Booking.id, afterId) : undefined,
          ),
        )
        .orderBy(Booking.id)
        .limit(MAX_NOTICES);

      for (const row of due) {
        if (window.notice === "reminder-day") {
          // A practice with an unknown time zone must not stop the others.
          let daytime: boolean;
          try {
            const hour = localHour(at, row.timezone);
            daytime = hour >= DAY_HOURS.from && hour < DAY_HOURS.until;
          } catch (error) {
            settled(row.id, window.notice, error);
            continue;
          }
          if (!daytime) continue;
        }
        const claimed = await db
          .update(Booking)
          .set(window.claim())
          .where(and(eq(Booking.id, row.id), window.pending))
          .returning({ id: Booking.id });
        if (claimed.length === 0) continue;
        try {
          await send(deliver, row, window.notice);
        } catch (error) {
          await db
            .update(Booking)
            .set(window.release)
            .where(eq(Booking.id, row.id));
          settled(row.id, window.notice, error);
        }
      }

      const last = due.at(-1);
      if (!last || due.length < MAX_NOTICES) break;
      afterId = last.id;
    }
  }
}

import { env, logger, paths } from "@synoro/config";
import {
  and,
  Booking,
  type Database,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  or,
  Practice,
  PracticeMember,
  user,
} from "@synoro/db";
import type { BookingNotice, TemplateEmail } from "@synoro/emails";

import { dispatchEmail } from "./index";

/**
 * Telling a client about their video meeting: the confirmation, the link when
 * the specialist sets or changes it, and reminders. Everything here is best
 * effort — a mail failure is logged and never undoes a booking or a save.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** One link change mails at most this many clients. */
const MAX_NOTICES = 200;

type Notice = BookingNotice;

/** How a mail leaves: `dispatchEmail` by default, a recorder in tests. */
export type Deliver = (message: TemplateEmail) => Promise<void>;

function cabinetUrl() {
  return new URL(
    paths.booking.mine,
    new URL(env.BOOKING_URL ?? env.APP_URL).origin,
  ).href;
}

function formatWhen(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** Confirmed paid bookings of clients who can be mailed. */
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

async function send(deliver: Deliver, row: Row, notice: Notice) {
  const videoUrl = row.meetingUrl ?? row.videoUrl;
  const subjects: Record<Notice, string> = {
    confirmed: `Запись подтверждена: ${row.practiceName}`,
    link: `Ссылка на видеовстречу: ${row.practiceName}`,
    "reminder-day": `Напоминание: встреча завтра — ${row.practiceName}`,
    "reminder-hour": `Напоминание: встреча через час — ${row.practiceName}`,
  };
  await deliver({
    template: "booking-notice",
    to: [row.clientEmail],
    subject: subjects[notice],
    props: {
      notice,
      name: row.clientName,
      practiceName: row.practiceName,
      when: formatWhen(row.startsAt, row.timezone),
      videoUrl,
      cabinetUrl: cabinetUrl(),
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

/** After payment (or a credit) confirmed a booking: tell the client. */
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
    if (!row) return;
    await send(deliver, row, "confirmed");
    if (row.meetingUrl ?? row.videoUrl) await markDueReminders(db, row);
  } catch (error) {
    settled(bookingId, "confirmed", error);
  }
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
    const rows = await confirmedBookings(db)
      .where(
        "bookingId" in scope
          ? and(upcoming, eq(Booking.id, scope.bookingId))
          : and(
              upcoming,
              eq(Booking.practiceId, scope.practiceId),
              isNull(Booking.meetingUrl),
            ),
      )
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
  } catch (error) {
    logger.warn("booking.video_notice_failed", {
      notice: "link",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Reminders with the link: once when the meeting is within a day, once when
 * it is within the hour. Only bookings that have a link are reminded. A
 * reminder is claimed in the database before it is sent, so two workers (or
 * a retry) never send it twice; a failed send gives the claim back.
 */
export async function sendVideoReminders(
  db: Database,
  deliver: Deliver = dispatchEmail,
) {
  const now = Date.now();
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
    const due = await confirmedBookings(db)
      .where(
        and(
          eq(Booking.kind, "consultation"),
          eq(Booking.status, "active"),
          isNull(Booking.holdUntil),
          window.pending,
          gt(Booking.startsAt, window.from),
          lte(Booking.startsAt, window.until),
          // Without any link it is not a video meeting (yet).
          or(isNotNull(Booking.meetingUrl), isNotNull(Practice.videoUrl)),
        ),
      )
      .limit(MAX_NOTICES);

    for (const row of due) {
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
  }
}

import { env, logger, paths } from "@synoro/config";
import {
  and,
  asc,
  Booking,
  type Database,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  Practice,
  PracticeMember,
  user,
} from "@synoro/db";

import { type Deliver, noticeSender } from "./messenger/deliver";
import { claimNotice } from "./notice-claims";
import { formatDay, formatTime, localDate, localHour } from "./when";

/**
 * «Расписание на завтра» (docs/reminders.md): every evening the owner and
 * the administrators of a practice get the next day's bookings, by mail or
 * by their messenger on «Про». A day with no bookings sends nothing; a
 * practice can turn it off (`practices.daily_agenda`).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The summary goes out from 20:00, practice time; a late worker has until 23:00. */
const AGENDA_HOURS = { from: 20, until: 23 };

interface AgendaPractice {
  id: string;
  name: string;
  timezone: string;
}

/** Tomorrow's bookings of `practice` with a client, earliest first. */
async function tomorrowsMeetings(
  db: Database,
  practice: AgendaPractice,
  at: Date,
) {
  const tomorrow = localDate(
    new Date(at.getTime() + DAY_MS),
    practice.timezone,
  );
  const rows = await db
    .select({
      startsAt: Booking.startsAt,
      endsAt: Booking.endsAt,
      kind: Booking.kind,
      guestName: Booking.guestName,
      guestPhone: Booking.guestPhone,
      clientName: user.name,
      clientPhone: user.phone,
    })
    .from(Booking)
    .leftJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .leftJoin(user, eq(user.id, PracticeMember.userId))
    .where(
      and(
        eq(Booking.practiceId, practice.id),
        eq(Booking.status, "active"),
        inArray(Booking.kind, ["consultation", "free"]),
        // An unpaid hold is not a booking yet.
        isNull(Booking.holdUntil),
        gt(Booking.startsAt, at),
        // From 20:00 the next day ends within 28 hours, 29 across DST.
        lt(Booking.startsAt, new Date(at.getTime() + 30 * HOUR_MS)),
      ),
    )
    .orderBy(asc(Booking.startsAt));
  return {
    tomorrow,
    meetings: rows.filter(
      (row) => localDate(row.startsAt, practice.timezone) === tomorrow,
    ),
  };
}

/** Sends `practice`'s summary of tomorrow to each of its staff, once. */
async function sendAgenda(
  db: Database,
  deliver: Deliver,
  practice: AgendaPractice,
  at: Date,
) {
  const { tomorrow, meetings } = await tomorrowsMeetings(db, practice, at);
  const first = meetings[0];
  if (!first) return;

  const staff = await db
    .select({ userId: user.id, email: user.email })
    .from(PracticeMember)
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(
      and(
        eq(PracticeMember.practiceId, practice.id),
        inArray(PracticeMember.role, ["owner", "admin"]),
      ),
    );
  const date = formatDay(first.startsAt, practice.timezone);
  const props = {
    practiceName: practice.name,
    date,
    meetings: meetings.map((m) => ({
      time: `${formatTime(m.startsAt, practice.timezone)}–${formatTime(m.endsAt, practice.timezone)}`,
      clientName: m.clientName ?? m.guestName ?? "Клиент",
      clientPhone: m.clientPhone ?? m.guestPhone,
      free: m.kind === "free",
    })),
    calendarUrl: new URL(paths.booking.calendar(practice.id), env.APP_URL).href,
  };

  for (const { userId, email } of staff) {
    const claim = await claimNotice(
      db,
      `agenda:${practice.id}:${tomorrow}:${userId}`,
      userId,
    );
    if (!claim) continue;
    try {
      await deliver(
        {
          template: "staff-agenda",
          to: [email],
          subject: `Расписание на завтра, ${date}: ${practice.name}`,
          props,
        },
        { userId, practiceId: practice.id },
      );
      await claim.done();
    } catch (error) {
      await claim.release();
      logger.warn("booking.agenda_failed", {
        practiceId: practice.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Sends the summaries due at `at`: practices where it is 20:00–23:00 now and
 * whose staff haven't had tomorrow's yet (claims in `sent_notices`, keys
 * `agenda:<practice>:<date>:<user>`). One practice failing never stops the
 * others.
 */
export async function sendStaffAgendas(
  db: Database,
  deliver: Deliver = noticeSender(db),
  at = new Date(),
) {
  const practices = await db
    .select({
      id: Practice.id,
      name: Practice.name,
      timezone: Practice.timezone,
    })
    .from(Practice)
    .where(eq(Practice.dailyAgenda, true));

  for (const practice of practices) {
    try {
      const hour = localHour(at, practice.timezone);
      if (hour < AGENDA_HOURS.from || hour >= AGENDA_HOURS.until) continue;
      await sendAgenda(db, deliver, practice, at);
    } catch (error) {
      logger.warn("booking.agenda_failed", {
        practiceId: practice.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

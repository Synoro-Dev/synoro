import { logger } from "@synoro/config";
import {
  and,
  asc,
  Booking,
  type Database,
  eq,
  gt,
  gte,
  isNull,
  lt,
  lte,
  ne,
  or,
  Practice,
  Service,
  user,
  WaitlistEntry,
} from "@synoro/db";
import { wishFits } from "@synoro/validators";

import { type Deliver, noticeSender } from "./messenger/deliver";
import { practicePageUrl } from "./urls";
import { describeDates, localDate } from "./when";

/**
 * The waiting list (`waitlist_entries`): when a booking is cancelled or moved
 * away, the people whose wish the freed time fits are told once. Nothing is
 * held for them — the time goes to whoever books it first, and the
 * `bookings_no_overlap` constraint settles a race. Best effort, like every
 * notice: a failure is logged and never undoes the cancellation.
 */

/** At most this many people hear of one freed time, oldest wish first. */
const MAX_NOTIFIED = 5;

/** Wishes read per freed time before they are sorted out by hours. */
const CANDIDATES = 50;

/** Minutes since local midnight of `at` in `timeZone`. */
function localMinute(at: Date, timeZone: string) {
  const [hour = 0, minute = 0] = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(at)
    .split(":")
    .map(Number);
  return hour * 60 + minute;
}

/**
 * Tell the waiting list that [`startsAt`, `endsAt`) of a practice is free.
 * `exceptUserId` — whoever just gave the time up is not told of it. Returns
 * how many were told.
 */
export async function notifyWaitlist(
  db: Database,
  freed: {
    practiceId: string;
    startsAt: Date;
    endsAt: Date;
    exceptUserId?: string | null;
  },
  deliver: Deliver = noticeSender(db),
) {
  try {
    const now = new Date();
    if (freed.startsAt <= now) return 0;

    // Someone may already have taken it, or still holds it unpaid.
    const [taken] = await db
      .select({ id: Booking.id })
      .from(Booking)
      .where(
        and(
          eq(Booking.practiceId, freed.practiceId),
          eq(Booking.status, "active"),
          or(isNull(Booking.holdUntil), gt(Booking.holdUntil, now)),
          lt(Booking.startsAt, freed.endsAt),
          gt(Booking.endsAt, freed.startsAt),
        ),
      )
      .limit(1);
    if (taken) return 0;

    const practice = await db.query.Practice.findFirst({
      where: eq(Practice.id, freed.practiceId),
      columns: { name: true, slug: true, timezone: true },
    });
    if (!practice) return 0;

    const date = localDate(freed.startsAt, practice.timezone);
    const startMinute = localMinute(freed.startsAt, practice.timezone);
    const slot = {
      date,
      startMinute,
      endMinute:
        startMinute +
        (freed.endsAt.getTime() - freed.startsAt.getTime()) / 60_000,
    };

    // What an entry without a service wants: the practice's first one.
    const [first] = await db
      .select({ minutes: Service.minutes })
      .from(Service)
      .where(
        and(eq(Service.practiceId, freed.practiceId), eq(Service.active, true)),
      )
      .orderBy(asc(Service.position), asc(Service.createdAt))
      .limit(1);
    const defaultMinutes = first?.minutes ?? 60;

    const candidates = await db
      .select({
        id: WaitlistEntry.id,
        userId: WaitlistEntry.userId,
        fromDate: WaitlistEntry.fromDate,
        toDate: WaitlistEntry.toDate,
        fromMinute: WaitlistEntry.fromMinute,
        toMinute: WaitlistEntry.toMinute,
        serviceMinutes: Service.minutes,
        name: user.name,
        email: user.email,
      })
      .from(WaitlistEntry)
      .innerJoin(user, eq(user.id, WaitlistEntry.userId))
      .leftJoin(Service, eq(Service.id, WaitlistEntry.serviceId))
      .where(
        and(
          eq(WaitlistEntry.practiceId, freed.practiceId),
          isNull(WaitlistEntry.notifiedAt),
          lte(WaitlistEntry.fromDate, date),
          gte(WaitlistEntry.toDate, date),
          freed.exceptUserId
            ? ne(WaitlistEntry.userId, freed.exceptUserId)
            : undefined,
        ),
      )
      .orderBy(asc(WaitlistEntry.createdAt))
      .limit(CANDIDATES);

    const fitting = candidates
      .filter((entry) =>
        wishFits(entry, slot, entry.serviceMinutes ?? defaultMinutes),
      )
      .slice(0, MAX_NOTIFIED);

    let told = 0;
    for (const entry of fitting) {
      // Claimed first: two cancellations at once tell a person once.
      const [claimed] = await db
        .update(WaitlistEntry)
        .set({ notifiedAt: new Date() })
        .where(
          and(eq(WaitlistEntry.id, entry.id), isNull(WaitlistEntry.notifiedAt)),
        )
        .returning({ id: WaitlistEntry.id });
      if (!claimed) continue;
      try {
        await deliver(
          {
            template: "waitlist-notice",
            to: [entry.email],
            subject: `Освободилось время: ${practice.name}`,
            props: {
              name: entry.name,
              practiceName: practice.name,
              when: describeDates([freed.startsAt], practice.timezone, {
                named: true,
              }).when,
              bookingUrl: practicePageUrl(practice.slug),
            },
          },
          { userId: entry.userId, practiceId: freed.practiceId },
        );
        told++;
      } catch (error) {
        logger.warn("waitlist.notice_failed", {
          entryId: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return told;
  } catch (error) {
    logger.warn("waitlist.notify_failed", {
      practiceId: freed.practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

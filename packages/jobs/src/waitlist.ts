import { logger } from "@synoro/config";
import {
  and,
  asc,
  Booking,
  type Database,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  Practice,
  Service,
  sql,
  user,
  WaitlistEntry,
} from "@synoro/db";
import { wishStart } from "@synoro/validators";

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

/** Wishes read at a time while looking for ones the freed time fits. */
const PAGE = 50;

/** Pages read at most per freed stretch: 1 000 wishes of one practice. */
const MAX_PAGES = 20;

interface Range {
  startsAt: Date;
  endsAt: Date;
}

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

/** The parts of `range` that no range of `busy` covers, in order. */
function freeParts(range: Range, busy: Range[]) {
  const parts: Range[] = [];
  let cursor = range.startsAt;
  for (const b of [...busy].sort(
    (x, y) => x.startsAt.getTime() - y.startsAt.getTime(),
  )) {
    if (b.endsAt <= cursor) continue;
    if (b.startsAt >= range.endsAt) break;
    if (b.startsAt > cursor) {
      parts.push({ startsAt: cursor, endsAt: b.startsAt });
    }
    if (b.endsAt > cursor) cursor = b.endsAt;
  }
  if (cursor < range.endsAt) {
    parts.push({ startsAt: cursor, endsAt: range.endsAt });
  }
  return parts;
}

/**
 * Tell the waiting list that [`startsAt`, `endsAt`) of a practice is free.
 * Time somebody has taken since (or holds unpaid) is left out, so a move that
 * only partly frees its old time still tells about the part that is free.
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

    const practice = await db.query.Practice.findFirst({
      where: eq(Practice.id, freed.practiceId),
      columns: { name: true, slug: true, timezone: true },
    });
    if (!practice) return 0;

    // Someone may already have taken some of it, or still holds it unpaid.
    const busy = await db
      .select({ startsAt: Booking.startsAt, endsAt: Booking.endsAt })
      .from(Booking)
      .where(
        and(
          eq(Booking.practiceId, freed.practiceId),
          eq(Booking.status, "active"),
          or(isNull(Booking.holdUntil), gt(Booking.holdUntil, now)),
          lt(Booking.startsAt, freed.endsAt),
          gt(Booking.endsAt, freed.startsAt),
        ),
      );
    const parts = freeParts(freed, busy);
    if (parts.length === 0) return 0;

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

    // Claimed first, one by one: two cancellations at once tell a person once.
    const claimed: {
      id: string;
      userId: string;
      name: string;
      email: string;
      startsAt: Date;
    }[] = [];

    try {
      for (const part of parts) {
        if (claimed.length >= MAX_NOTIFIED) break;
        const date = localDate(part.startsAt, practice.timezone);
        const startMinute = localMinute(part.startsAt, practice.timezone);
        const slot = {
          date,
          startMinute,
          endMinute:
            startMinute +
            (part.endsAt.getTime() - part.startsAt.getTime()) / 60_000,
        };

        // Wishes are read page by page until enough of them fit: the oldest
        // ones may all want another time of the day. The next page starts after
        // the last wish seen (`createdAt`, `id`), not at an offset: wishes
        // claimed from this page leave the query and would shift an offset. The
        // cursor keeps `createdAt` as the database wrote it, in microseconds: a
        // JavaScript `Date` has milliseconds, and rows within one of them would
        // come back page after page.
        let after: { createdAt: string; id: string } | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          if (claimed.length >= MAX_NOTIFIED) break;
          const entries = await db
            .select({
              id: WaitlistEntry.id,
              cursor: sql<string>`${WaitlistEntry.createdAt}::text`,
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
                // A visitor's wish counts once their email is confirmed.
                isNotNull(WaitlistEntry.confirmedAt),
                isNull(WaitlistEntry.notifiedAt),
                lte(WaitlistEntry.fromDate, date),
                gte(WaitlistEntry.toDate, date),
                // A wish for a service that is switched off can't be booked:
                // it is left as it is, not closed by a useless message.
                or(isNull(WaitlistEntry.serviceId), eq(Service.active, true)),
                freed.exceptUserId
                  ? ne(WaitlistEntry.userId, freed.exceptUserId)
                  : undefined,
                after
                  ? sql`(${WaitlistEntry.createdAt}, ${WaitlistEntry.id}) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`
                  : undefined,
              ),
            )
            .orderBy(asc(WaitlistEntry.createdAt), asc(WaitlistEntry.id))
            .limit(PAGE);

          for (const entry of entries) {
            if (claimed.length >= MAX_NOTIFIED) break;
            const start = wishStart(
              entry,
              slot,
              entry.serviceMinutes ?? defaultMinutes,
            );
            if (start === null) continue;
            const [row] = await db
              .update(WaitlistEntry)
              .set({ notifiedAt: new Date() })
              .where(
                and(
                  eq(WaitlistEntry.id, entry.id),
                  isNull(WaitlistEntry.notifiedAt),
                ),
              )
              .returning({ id: WaitlistEntry.id });
            if (!row) continue;
            claimed.push({
              id: entry.id,
              userId: entry.userId,
              name: entry.name,
              email: entry.email,
              // The first time the wished meeting could begin, not the window's.
              startsAt: new Date(
                part.startsAt.getTime() + (start - startMinute) * 60_000,
              ),
            });
          }
          const last = entries.at(-1);
          if (entries.length < PAGE || !last) break;
          after = { createdAt: last.cursor, id: last.id };
        }
      }
    } catch (error) {
      // A page failed to read after some wishes were claimed: nobody has been
      // written to yet, so give those back (only the ones this call claimed).
      if (claimed.length > 0) {
        await db
          .update(WaitlistEntry)
          .set({ notifiedAt: null })
          .where(
            inArray(
              WaitlistEntry.id,
              claimed.map((entry) => entry.id),
            ),
          );
      }
      throw error;
    }

    const results = await Promise.all(
      claimed.map(async (entry) => {
        try {
          await deliver(
            {
              template: "waitlist-notice",
              to: [entry.email],
              subject: `Освободилось время: ${practice.name}`,
              props: {
                name: entry.name,
                practiceName: practice.name,
                when: describeDates([entry.startsAt], practice.timezone, {
                  named: true,
                }).when,
                bookingUrl: practicePageUrl(practice.slug),
              },
            },
            { userId: entry.userId, practiceId: freed.practiceId },
          );
          return true;
        } catch (error) {
          // Nothing reached them: the wish stays open for the next free time.
          logger.warn("waitlist.notice_failed", {
            entryId: entry.id,
            error: error instanceof Error ? error.message : String(error),
          });
          await db
            .update(WaitlistEntry)
            .set({ notifiedAt: null })
            .where(eq(WaitlistEntry.id, entry.id))
            .catch((releaseError: unknown) =>
              logger.warn("waitlist.release_failed", {
                entryId: entry.id,
                error:
                  releaseError instanceof Error
                    ? releaseError.message
                    : String(releaseError),
              }),
            );
          return false;
        }
      }),
    );
    return results.filter(Boolean).length;
  } catch (error) {
    logger.warn("waitlist.notify_failed", {
      practiceId: freed.practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

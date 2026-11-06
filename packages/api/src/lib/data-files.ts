import { createHash, randomBytes } from "node:crypto";

import { env } from "@synoro/config";
import {
  CalendarFeed,
  type Database,
  DataExport,
  eq,
  Practice,
} from "@synoro/db";
import {
  bookingEvents,
  buildCalendar,
  collectForFeed,
  recordDataAudit,
} from "@synoro/jobs/data-export";

import { mayTouchData } from "./data-access";

const DAY_MS = 24 * 60 * 60 * 1000;
const FEED_PAST_MS = 90 * DAY_MS;
/** No need for a write every time a calendar comes asking. */
const FEED_TOUCH_MS = 60 * 60 * 1000;

export function hashFeedToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newFeedToken() {
  return randomBytes(24).toString("base64url");
}

export function feedUrl(token: string) {
  return new URL(`/api/calendar/${token}`, env.APP_URL).href;
}

/**
 * The feed behind a secret link: active bookings from the last 90 days on, or
 * null for an unknown token. A cancelled booking just leaves the feed, and so
 * does a held one nobody paid for in time.
 */
export async function calendarFeedBody(
  db: Database,
  token: string,
  now = new Date(),
) {
  const [row] = await db
    .select({
      practiceId: CalendarFeed.practiceId,
      showNames: CalendarFeed.showNames,
      lastFetchedAt: CalendarFeed.lastFetchedAt,
      name: Practice.name,
      profession: Practice.profession,
      videoUrl: Practice.videoUrl,
    })
    .from(CalendarFeed)
    .innerJoin(Practice, eq(Practice.id, CalendarFeed.practiceId))
    .where(eq(CalendarFeed.tokenHash, hashFeedToken(token)))
    .limit(1);
  if (!row) return null;

  const { people, bookings } = await collectForFeed(
    db,
    row.practiceId,
    new Date(now.getTime() - FEED_PAST_MS),
  );
  const live = bookings.filter(
    (booking) =>
      booking.status === "active" &&
      (!booking.hold_until || new Date(booking.hold_until) > now),
  );

  if (
    !row.lastFetchedAt ||
    now.getTime() - row.lastFetchedAt.getTime() > FEED_TOUCH_MS
  ) {
    await db
      .update(CalendarFeed)
      .set({ lastFetchedAt: now })
      .where(eq(CalendarFeed.practiceId, row.practiceId));
  }

  return buildCalendar(
    row.name,
    bookingEvents(
      {
        name: row.name,
        profession: row.profession,
        video_url: row.videoUrl,
      },
      live,
      new Map(people.map((person) => [person.id, person])),
      row.showNames,
    ),
    now,
  );
}

type DownloadSession = Parameters<typeof mayTouchData>[0] & {
  user: { id: string; email: string };
};

/**
 * Who may download an archive: its owner, signed in as themselves, while the
 * link lives. Someone else's archive answers 403, one that ran out 410.
 */
export async function openExportDownload(
  db: Database,
  session: DownloadSession | null,
  exportId: string,
  now = new Date(),
) {
  if (!session) return { status: 401 as const };

  const row = await db.query.DataExport.findFirst({
    where: eq(DataExport.id, exportId),
  });
  if (!row) return { status: 404 as const };
  if (row.userId !== session.user.id || !mayTouchData(session)) {
    return { status: 403 as const };
  }
  if (
    row.status !== "ready" ||
    !row.fileKey ||
    !row.expiresAt ||
    row.expiresAt <= now
  ) {
    return { status: 410 as const };
  }

  await recordDataAudit(db, {
    userId: session.user.id,
    actorId: session.user.id,
    action: "export_downloaded",
    details: { kind: row.kind },
  });

  return {
    status: 200 as const,
    key: row.fileKey,
    filename: `synoro-${row.kind === "weekly" ? "clients" : "data"}-${row.createdAt.toISOString().slice(0, 10)}.zip`,
  };
}

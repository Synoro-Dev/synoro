import { createHash, timingSafeEqual } from "node:crypto";

import { env, logger } from "@synoro/config";
import {
  and,
  asc,
  Booking,
  CreditEntry,
  type Database,
  eq,
  gt,
  isExclusionViolation,
  isNotNull,
  isNull,
  isUniqueViolation,
  lte,
  Practice,
  PracticeMember,
  StandingTime,
  user,
} from "@synoro/db";
import { ownerStaying } from "@synoro/jobs/account-deletion";
import type { Deliver } from "@synoro/jobs/messenger";
import { sendStandingNotice } from "@synoro/jobs/standing-notices";
import { describeDates } from "@synoro/jobs/when";

import { hasPro } from "./billing";
import { adjustCredits, loadRules, releaseExpiredHolds } from "./bookings";
import { exportBooking, googleBusy } from "./google-calendar";
import { findOpenPractice } from "./practice-access";
import { isScheduledSlot, overlaps, seriesSlots } from "./schedule";
import { resolveService } from "./services";
import { payBookingUrl } from "./urls";

/**
 * A standing time («Про», `docs/standing-time.md`): bookings are made this far
 * ahead, by `extendStanding`, and the cron `standing-horizon` moves the
 * horizon every day.
 */
const STANDING_HORIZON_DAYS = 28;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** An unfunded occurrence is held until this long before it starts… */
const HOLD_LEAD_MS = 48 * HOUR_MS;
/** …but at least this long from now, so a payment link is not dead on arrival. */
const MIN_HOLD_MS = 12 * HOUR_MS;
/** A client is reminded this long before a hold runs out. */
const REMIND_BEFORE_MS = 72 * HOUR_MS;
/** A pause is announced for this long after it began. */
const PAUSE_NOTICE_MS = 7 * DAY_MS;

type Standing = typeof StandingTime.$inferSelect;

/** What an occurrence copies from the standing time's first booking. */
export interface OccurrenceTemplate {
  note: string | null;
  answers: (typeof Booking.$inferInsert)["answers"];
  clientTimezone: string | null;
}

/**
 * The occurrences of a standing time in (`after`, `until`]: its first time,
 * then every `intervalWeeks` weeks at the same local time. A wall time that
 * a daylight saving jump skips is left out.
 */
export function standingOccurrences(
  standing: Pick<Standing, "startsAt" | "intervalWeeks">,
  timeZone: string,
  after: Date,
  until: Date,
) {
  const step = standing.intervalWeeks * 7 * DAY_MS;
  const count = Math.min(
    Math.floor((until.getTime() - standing.startsAt.getTime()) / step) + 2,
    600,
  );
  if (count < 1) return [];
  return seriesSlots(standing.startsAt, standing.intervalWeeks, count, timeZone)
    .filter((s) => s.exists && s.startsAt > after && s.startsAt <= until)
    .map((s) => s.startsAt);
}

/** Until when an unfunded occurrence is held. */
export function standingHoldUntil(startsAt: Date, now: Date) {
  const ideal = startsAt.getTime() - HOLD_LEAD_MS;
  const earliest = now.getTime() + MIN_HOLD_MS;
  return new Date(Math.min(Math.max(ideal, earliest), startsAt.getTime()));
}

/** The first booking of a standing time, to copy answers and the note from. */
async function templateOf(
  db: Database,
  standingId: string,
): Promise<OccurrenceTemplate> {
  const [first] = await db
    .select({
      note: Booking.note,
      answers: Booking.answers,
      clientTimezone: Booking.clientTimezone,
    })
    .from(Booking)
    .where(eq(Booking.standingId, standingId))
    .orderBy(asc(Booking.createdAt))
    .limit(1);
  return first ?? { note: null, answers: null, clientTimezone: null };
}

/** Where a notice about a standing time goes. */
async function recipientOf(db: Database, memberId: string) {
  const [row] = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      credits: PracticeMember.credits,
    })
    .from(PracticeMember)
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(eq(PracticeMember.id, memberId));
  return row;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Make the standing time's bookings up to the horizon (4 weeks ahead): every
 * occurrence that has none yet. An occurrence the balance pays for is
 * confirmed and takes its price; one it does not is held, until 48 hours
 * before it starts, and the client is sent the payment link once. A date that
 * is off the schedule or already taken is skipped, and one that was made once
 * is never made again, however its booking ended up (`standing_slot`).
 * Does nothing for a paused or ended standing time, or when the owner's
 * «Про» has run out.
 *
 * Returns the bookings made now. Google Calendar is updated, and the notice
 * about unpaid dates sent, here; a confirmation mail is the caller's choice.
 */
export async function extendStanding(
  db: Database,
  standing: Standing,
  options: {
    now?: Date;
    template?: OccurrenceTemplate;
    /** Where the notice about unpaid dates goes; the client's channel. */
    deliver?: Deliver;
  } = {},
) {
  const now = options.now ?? new Date();
  const made = {
    confirmed: [] as { id: string; startsAt: Date }[],
    held: [] as { id: string; startsAt: Date; holdUntil: Date }[],
  };
  if (standing.endedAt || standing.pausedAt) return made;

  const practice = await findOpenPractice(db, standing.practiceId);
  if (!practice || !(await hasPro(db, practice.ownerId))) return made;
  const service = await resolveService(
    db,
    practice.id,
    standing.serviceId ?? undefined,
  );
  if (!service) return made;
  const client = await recipientOf(db, standing.memberId);
  if (!client) return made;
  // Paid at the visit: nothing is taken from a balance, every date is firm.
  const price = practice.payAtVisit ? 0 : service.credits;

  await releaseExpiredHolds(db, practice.id);
  // The release may have paused it: a hold of its own ran out.
  const [current] = await db
    .select({ pausedAt: StandingTime.pausedAt, endedAt: StandingTime.endedAt })
    .from(StandingTime)
    .where(eq(StandingTime.id, standing.id));
  if (!current || current.pausedAt || current.endedAt) return made;

  const horizon = new Date(now.getTime() + STANDING_HORIZON_DAYS * DAY_MS);
  const wanted = standingOccurrences(standing, practice.timezone, now, horizon);
  const known = new Set(
    (
      await db
        .select({ slot: Booking.standingSlot })
        .from(Booking)
        .where(eq(Booking.standingId, standing.id))
    ).map((b) => b.slot?.getTime()),
  );
  const missing = wanted.filter((at) => !known.has(at.getTime()));
  if (missing.length === 0) return made;

  const rules = await loadRules(db, practice.id);
  const template = options.template ?? (await templateOf(db, standing.id));
  // What the specialist has in Google Calendar over these dates, like the
  // first date's check (`previewSeries`); Google being down reads as free.
  const lastAt = missing.at(-1);
  const busy =
    missing[0] && lastAt
      ? await googleBusy(
          db,
          practice.id,
          missing[0],
          new Date(lastAt.getTime() + service.minutes * 60_000),
        )
      : [];
  for (const startsAt of missing) {
    const range = {
      startsAt,
      endsAt: new Date(startsAt.getTime() + service.minutes * 60_000),
    };
    if (busy.some((b) => overlaps(b, range))) {
      logger.info("standing.slot_busy_in_google", {
        standingId: standing.id,
        startsAt: startsAt.toISOString(),
      });
      continue;
    }
    if (
      !isScheduledSlot({
        rules,
        startsAt,
        timeZone: practice.timezone,
        kind: "consultation",
        minutes: service.minutes,
        now,
      })
    ) {
      logger.info("standing.slot_off_schedule", {
        standingId: standing.id,
        startsAt: startsAt.toISOString(),
      });
      continue;
    }
    try {
      const booking = await db.transaction(async (tx) => {
        // Under the standing time's lock: `standing.end` and a pause take it
        // too, so nothing is made, or paid for, after either has happened.
        const [live] = await tx
          .select({
            pausedAt: StandingTime.pausedAt,
            endedAt: StandingTime.endedAt,
          })
          .from(StandingTime)
          .where(eq(StandingTime.id, standing.id))
          .for("update");
        if (!live || live.pausedAt || live.endedAt) return undefined;
        const funded =
          price === 0 ||
          (await adjustCredits(tx, standing.memberId, -price)) !== undefined;
        const holdUntil = funded ? null : standingHoldUntil(startsAt, now);
        const [row] = await tx
          .insert(Booking)
          .values({
            practiceId: practice.id,
            kind: "consultation",
            serviceId: service.id,
            credits: price,
            startsAt,
            endsAt: new Date(startsAt.getTime() + service.minutes * 60_000),
            memberId: standing.memberId,
            note: template.note,
            answers: template.answers,
            clientTimezone: template.clientTimezone,
            standingId: standing.id,
            standingSlot: startsAt,
            holdUntil,
            createdById: standing.createdById,
          })
          .returning({ id: Booking.id });
        if (!row) throw new Error("Failed to insert booking");
        if (funded && price > 0) {
          await tx.insert(CreditEntry).values({
            memberId: standing.memberId,
            delta: -price,
            reason: "booking",
            bookingId: row.id,
            note: "Постоянное время",
            createdById: standing.createdById,
          });
        }
        return { id: row.id, holdUntil };
      });
      // Ended or paused while this run was at work: nothing more is made.
      if (!booking) break;
      if (booking.holdUntil) {
        made.held.push({ ...booking, startsAt, holdUntil: booking.holdUntil });
      } else made.confirmed.push({ id: booking.id, startsAt });
    } catch (error) {
      // Taken by someone else meanwhile, or made by a parallel run.
      if (
        isExclusionViolation(error, "bookings_no_overlap") ||
        isUniqueViolation(error, "bookings_standing_slot_unique")
      ) {
        logger.info("standing.slot_taken", {
          standingId: standing.id,
          startsAt: startsAt.toISOString(),
        });
        continue;
      }
      throw error;
    }
  }

  for (const b of made.confirmed) await exportBooking(db, b.id);
  const earliest = made.held[0];
  if (earliest) {
    const zone = template.clientTimezone ?? practice.timezone;
    const when = describeDates(
      made.held.map((b) => b.startsAt),
      zone,
      { named: true },
    );
    await sendStandingNotice(
      db,
      {
        key: `standing:due:${standing.id}:${earliest.startsAt.getTime()}`,
        userId: client.userId,
        practiceId: practice.id,
        practiceName: practice.name,
        to: client.email,
        title: `Пакет закончился: ${practice.name}`,
        text: `${firstName(client.name)}, ваше постоянное время у «${practice.name}» продолжается, но оплаченных занятий на балансе не хватает. Время закреплено за вами: ${when.when}${when.dates.length ? ` (${when.dates.join("; ")})` : ""}. Оплатите пакет до ${describeDates([earliest.holdUntil], zone, { named: true }).when} — иначе время освободится, а постоянное время встанет на паузу.\n\nОплатить: ${payBookingUrl(practice.slug)}`,
      },
      options.deliver,
    );
  }
  return made;
}

/**
 * Money arrived (a payment, a grant, a refund): confirm the member's held
 * standing-time dates, earliest first, as far as the balance goes. Each takes
 * its price and its hold is lifted in one transaction. Returns the confirmed
 * bookings' ids.
 */
export async function settleStandingHolds(
  db: Database,
  memberId: string,
  now = new Date(),
) {
  // Only the holds of a standing time that is running, in a practice that is
  // open (its owner is not deleting the account): money coming in must not
  // pay for dates nobody is going to keep.
  const held = await db
    .select({ id: Booking.id, credits: Booking.credits })
    .from(Booking)
    .innerJoin(StandingTime, eq(StandingTime.id, Booking.standingId))
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .where(
      and(
        eq(Booking.memberId, memberId),
        eq(Booking.status, "active"),
        isNotNull(Booking.holdUntil),
        gt(Booking.holdUntil, now),
        isNull(StandingTime.endedAt),
        isNull(StandingTime.pausedAt),
        ownerStaying(Practice.ownerId),
      ),
    )
    .orderBy(asc(Booking.startsAt));
  const confirmed: string[] = [];
  for (const b of held) {
    const done = await db
      .transaction(async (tx) => {
        const lifted = await tx
          .update(Booking)
          .set({ holdUntil: null })
          .where(
            and(
              eq(Booking.id, b.id),
              eq(Booking.status, "active"),
              isNotNull(Booking.holdUntil),
            ),
          )
          .returning({ id: Booking.id });
        // Confirmed or released by someone else meanwhile.
        if (lifted.length === 0) return "gone" as const;
        if ((await adjustCredits(tx, memberId, -b.credits)) === undefined) {
          // Not enough: put the hold back by failing the transaction.
          throw new NotEnoughCredits();
        }
        await tx.insert(CreditEntry).values({
          memberId,
          delta: -b.credits,
          reason: "booking",
          bookingId: b.id,
          note: "Постоянное время",
        });
        return "confirmed" as const;
      })
      .catch((error) => {
        if (error instanceof NotEnoughCredits) return "short" as const;
        throw error;
      });
    if (done === "short") break;
    if (done === "confirmed") confirmed.push(b.id);
  }
  for (const id of confirmed) await exportBooking(db, id);
  return confirmed;
}

class NotEnoughCredits extends Error {}

/**
 * The daily run of `standing-horizon`: let go of holds that ran out (which
 * pauses their standing times), confirm held dates the balance now covers,
 * move every active standing time's horizon, then send the reminders and the
 * pause notices. One standing time failing is logged and does not stop the
 * others.
 */
export async function runStandingHorizon(
  db: Database,
  options: { now?: Date; deliver?: Deliver } = {},
) {
  const now = options.now ?? new Date();
  const live = await db
    .select()
    .from(StandingTime)
    .where(isNull(StandingTime.endedAt));
  for (const practiceId of new Set(live.map((s) => s.practiceId))) {
    await releaseExpiredHolds(db, practiceId);
  }

  let made = 0;
  for (const standing of live) {
    try {
      await settleStandingHolds(db, standing.memberId, now);
      const result = await extendStanding(db, standing, {
        now,
        deliver: options.deliver,
      });
      made += result.confirmed.length + result.held.length;
    } catch (error) {
      logger.warn("standing.horizon_failed", {
        standingId: standing.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const noticed = await sendStandingReminders(db, now, options.deliver);
  return { standingTimes: live.length, made, noticed };
}

/** Notices that follow the day's run: a hold running out, a pause. */
async function sendStandingReminders(
  db: Database,
  now: Date,
  deliver?: Deliver,
) {
  let sent = 0;
  // A hold that runs out within three days: once per held booking.
  const soon = await db
    .select({
      bookingId: Booking.id,
      standingId: StandingTime.id,
      startsAt: Booking.startsAt,
      holdUntil: Booking.holdUntil,
      clientTimezone: Booking.clientTimezone,
      memberId: Booking.memberId,
      practiceId: Practice.id,
      practiceName: Practice.name,
      slug: Practice.slug,
      timezone: Practice.timezone,
    })
    .from(Booking)
    .innerJoin(StandingTime, eq(StandingTime.id, Booking.standingId))
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .where(
      and(
        eq(Booking.status, "active"),
        isNotNull(Booking.holdUntil),
        gt(Booking.holdUntil, now),
        lte(Booking.holdUntil, new Date(now.getTime() + REMIND_BEFORE_MS)),
        isNull(StandingTime.endedAt),
        // A practice being deleted is not written for.
        ownerStaying(Practice.ownerId),
      ),
    )
    .orderBy(asc(Booking.startsAt));
  const seen = new Set<string>();
  for (const row of soon) {
    // One reminder per standing time and run: the earliest hold speaks for all.
    if (seen.has(row.standingId) || !row.memberId || !row.holdUntil) continue;
    seen.add(row.standingId);
    const client = await recipientOf(db, row.memberId);
    if (!client) continue;
    const zone = row.clientTimezone ?? row.timezone;
    const ok = await sendStandingNotice(
      db,
      {
        key: `standing:remind:${row.standingId}:${row.bookingId}`,
        userId: client.userId,
        practiceId: row.practiceId,
        practiceName: row.practiceName,
        to: client.email,
        title: `Время скоро освободится: ${row.practiceName}`,
        text: `${firstName(client.name)}, за вами закреплено время ${describeDates([row.startsAt], zone, { named: true }).when}, но пакет не оплачен. Оплатите до ${describeDates([row.holdUntil], zone, { named: true }).when}, иначе время освободится, а постоянное время встанет на паузу.\n\nОплатить: ${payBookingUrl(row.slug)}`,
      },
      deliver,
    );
    if (ok) sent++;
  }

  // A standing time paused by an unpaid hold: tell the client how to resume.
  const paused = await db
    .select({
      standingId: StandingTime.id,
      pausedAt: StandingTime.pausedAt,
      memberId: StandingTime.memberId,
      practiceId: Practice.id,
      practiceName: Practice.name,
      slug: Practice.slug,
    })
    .from(StandingTime)
    .innerJoin(Practice, eq(Practice.id, StandingTime.practiceId))
    .where(
      and(
        isNotNull(StandingTime.pausedAt),
        isNull(StandingTime.endedAt),
        ownerStaying(Practice.ownerId),
        gt(StandingTime.pausedAt, new Date(now.getTime() - PAUSE_NOTICE_MS)),
      ),
    );
  for (const row of paused) {
    if (!row.pausedAt) continue;
    const client = await recipientOf(db, row.memberId);
    if (!client) continue;
    const ok = await sendStandingNotice(
      db,
      {
        key: `standing:paused:${row.standingId}:${row.pausedAt.getTime()}`,
        userId: client.userId,
        practiceId: row.practiceId,
        practiceName: row.practiceName,
        to: client.email,
        title: `Постоянное время на паузе: ${row.practiceName}`,
        text: `${firstName(client.name)}, пакет не был оплачен вовремя, поэтому неоплаченные даты освободились, а постоянное время у «${row.practiceName}» поставлено на паузу. Подтверждённые записи остаются.\n\nЧтобы вернуть постоянное время, оплатите пакет и возобновите его в личном кабинете: ${payBookingUrl(row.slug)}`,
      },
      deliver,
    );
    if (ok) sent++;
  }
  return sent;
}

/** The shortest `CRON_SECRET` the endpoint accepts. */
const CRON_SECRET_MIN = 16;

/**
 * `POST /api/cron/standing`: the daily run, called by the Hatchet worker
 * (`standing-horizon` in `@synoro/jobs`) with `Authorization: Bearer
 * <CRON_SECRET>`. The run needs the API's own libraries (credits, Google
 * Calendar), which the worker package cannot import, so the worker asks the
 * app to do it. 404 without a usable secret, 401 for a wrong one.
 */
export async function handleStandingCron(
  request: Request,
  db: Database,
): Promise<Response> {
  const secret = env.CRON_SECRET;
  if (!secret || secret.length < CRON_SECRET_MIN) {
    return new Response(null, { status: 404 });
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const given = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
    return new Response(null, { status: 401 });
  }
  const result = await runStandingHorizon(db);
  logger.info("standing.horizon_done", result);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

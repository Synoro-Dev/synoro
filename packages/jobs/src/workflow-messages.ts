import { logger } from "@synoro/config";
import {
  alias,
  and,
  asc,
  Booking,
  CreditEntry,
  type Database,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  notExists,
  or,
  Practice,
  PracticeMember,
  SentNotice,
  Subscription,
  sql,
  user,
  Workflow,
} from "@synoro/db";
import {
  renderWorkflowText,
  type WorkflowTrigger,
  type WorkflowVariable,
} from "@synoro/validators";

import type { Deliver } from "./booking-video";
import { dispatchEmail } from "./index";
import { claimNotice } from "./notice-claims";
import { cabinetUrl, practicePageUrl } from "./urls";
import { localHour } from "./when";

/**
 * A specialist's own messages to clients («Про», `workflows`): thanks after a
 * meeting, a nudge to top up a package, a note to a client who went quiet.
 * A cron finds what is due, claims each message in `sent_notices`
 * (`wf:<rule>:…`, see `./notice-claims`) and mails it. Rules of an owner
 * whose «Про» ran out are skipped, not deleted.
 *
 * A rule only reaches back to when it was created and no further than its
 * window, so a new rule never mails the whole history and a worker that
 * was down for a night catches up without repeating itself.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How late a meeting-based message may still go out. */
const EVENT_WINDOW_MS = 2 * DAY_MS;
/** How late a «not seen for N days» message may still go out. */
const IDLE_WINDOW_MS = 7 * DAY_MS;
/** A booking that left few meetings waits a little: the client may top up. */
const LOW_BALANCE_DELAY_MS = 10 * 60 * 1000;
/** Clients are mailed from 9:00 to 21:00, practice time. */
const DAY_HOURS = { from: 9, until: 21 };
const MAX_BATCH = 200;

interface Rule {
  id: string;
  practiceId: string;
  trigger: WorkflowTrigger;
  amount: number;
  subject: string;
  text: string;
  createdAt: Date;
  practiceName: string;
  slug: string;
  timezone: string;
}

/** A client due a message. */
interface Candidate {
  /** Where the next page starts; ordered the same way as the query. */
  cursor: string;
  /** The occasion: the same key is never mailed twice. */
  key: string;
  userId: string;
  name: string;
  email: string;
  credits: number;
  /** The meeting the message is about. */
  startsAt: Date;
}

type CandidateQuery = (
  db: Database,
  rule: Rule,
  now: Date,
  afterId: string | undefined,
) => Promise<Candidate[]>;

/** Rules are only due after they were created. */
function dueFrom(rule: Rule, now: Date, windowMs: number) {
  return new Date(Math.max(now.getTime() - windowMs, rule.createdAt.getTime()));
}

/** Clients whose meeting ended `amount` hours ago. */
const afterEnd: CandidateQuery = async (db, rule, now, afterId) => {
  const shift = rule.amount * HOUR_MS;
  const from = dueFrom(rule, now, EVENT_WINDOW_MS);
  const rows = await db
    .select({
      id: Booking.id,
      startsAt: Booking.startsAt,
      userId: user.id,
      name: user.name,
      email: user.email,
      credits: PracticeMember.credits,
    })
    .from(Booking)
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(
      and(
        eq(Booking.practiceId, rule.practiceId),
        eq(Booking.kind, "consultation"),
        eq(Booking.status, "active"),
        sql`${Booking.holdUntil} is null`,
        eq(PracticeMember.role, "client"),
        gt(Booking.endsAt, new Date(from.getTime() - shift)),
        lte(Booking.endsAt, new Date(now.getTime() - shift)),
        afterId ? gt(Booking.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(Booking.id))
    .limit(MAX_BATCH);
  return rows.map(({ id, ...row }) => ({
    ...row,
    cursor: id,
    key: `wf:${rule.id}:b:${id}`,
  }));
};

/**
 * Clients whose latest balance change is a booking that left `amount`
 * meetings or fewer. A top-up or a refund after it is a newer change, so the
 * client is not nagged after paying.
 */
const lowBalance: CandidateQuery = async (db, rule, now, afterId) => {
  const entry = alias(CreditEntry, "entry");
  const newer = alias(CreditEntry, "newer");
  const rows = await db
    .select({
      id: entry.id,
      memberId: entry.memberId,
      createdAt: entry.createdAt,
      startsAt: Booking.startsAt,
      userId: user.id,
      name: user.name,
      email: user.email,
      credits: PracticeMember.credits,
    })
    .from(entry)
    .innerJoin(PracticeMember, eq(PracticeMember.id, entry.memberId))
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .leftJoin(Booking, eq(Booking.id, entry.bookingId))
    .where(
      and(
        eq(PracticeMember.practiceId, rule.practiceId),
        eq(PracticeMember.role, "client"),
        eq(entry.reason, "booking"),
        gt(entry.createdAt, dueFrom(rule, now, EVENT_WINDOW_MS)),
        lte(entry.createdAt, new Date(now.getTime() - LOW_BALANCE_DELAY_MS)),
        lte(PracticeMember.credits, rule.amount),
        notExists(
          db
            .select({ one: sql`1` })
            .from(newer)
            .where(
              and(
                eq(newer.memberId, entry.memberId),
                or(
                  gt(newer.createdAt, entry.createdAt),
                  and(
                    eq(newer.createdAt, entry.createdAt),
                    gt(newer.id, entry.id),
                  ),
                ),
              ),
            ),
        ),
        afterId ? gt(entry.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(entry.id))
    .limit(MAX_BATCH);
  return rows.map(({ id, memberId, createdAt, startsAt, ...row }) => ({
    ...row,
    startsAt: startsAt ?? createdAt,
    cursor: id,
    key: `wf:${rule.id}:low:${memberId}:${id}`,
  }));
};

/**
 * Clients whose last meeting ended `amount` days ago and who have nothing
 * booked since. Grouping by client: the latest end beyond the cut-off also
 * rules out anyone with a booking still ahead.
 */
const inactive: CandidateQuery = async (db, rule, now, afterId) => {
  const shift = rule.amount * DAY_MS;
  const from = dueFrom(rule, now, IDLE_WINDOW_MS);
  const lastEnd = sql<Date>`max(${Booking.endsAt})`.mapWith(Booking.endsAt);
  const lastStart = sql<Date>`max(${Booking.startsAt})`.mapWith(
    Booking.startsAt,
  );
  const rows = await db
    .select({
      id: PracticeMember.id,
      lastEnd,
      startsAt: lastStart,
      userId: user.id,
      name: user.name,
      email: user.email,
      credits: PracticeMember.credits,
    })
    .from(Booking)
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(
      and(
        eq(Booking.practiceId, rule.practiceId),
        eq(Booking.kind, "consultation"),
        eq(Booking.status, "active"),
        sql`${Booking.holdUntil} is null`,
        eq(PracticeMember.role, "client"),
        afterId ? gt(PracticeMember.id, afterId) : undefined,
      ),
    )
    .groupBy(PracticeMember.id, user.id)
    .having(
      and(
        sql`${lastEnd} > ${new Date(from.getTime() - shift).toISOString()}::timestamptz`,
        sql`${lastEnd} <= ${new Date(now.getTime() - shift).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(PracticeMember.id))
    .limit(MAX_BATCH);
  return rows.map(({ id, lastEnd: ended, ...row }) => ({
    ...row,
    cursor: id,
    key: `wf:${rule.id}:idle:${id}:${ended.getTime()}`,
  }));
};

const QUERIES: Record<WorkflowTrigger, CandidateQuery> = {
  after_end: afterEnd,
  low_balance: lowBalance,
  inactive,
};

/** Active rules of practices whose owner has «Про» right now. */
function activeRules(db: Database, now: Date): Promise<Rule[]> {
  return db
    .select({
      id: Workflow.id,
      practiceId: Workflow.practiceId,
      trigger: Workflow.trigger,
      amount: Workflow.amount,
      subject: Workflow.subject,
      text: Workflow.text,
      createdAt: Workflow.createdAt,
      practiceName: Practice.name,
      slug: Practice.slug,
      timezone: Practice.timezone,
    })
    .from(Workflow)
    .innerJoin(Practice, eq(Practice.id, Workflow.practiceId))
    .innerJoin(Subscription, eq(Subscription.userId, Practice.ownerId))
    .where(
      and(
        eq(Workflow.active, true),
        sql`greatest(${Subscription.trialEndsAt}, coalesce(${Subscription.paidUntil}, ${Subscription.trialEndsAt})) > ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(Workflow.id));
}

/** «3 ноября» and «19:00» in the practice's time zone. */
function formatMeeting(at: Date, timeZone: string) {
  return {
    дата: new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "numeric",
      month: "long",
    }).format(at),
    время: new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(at),
  };
}

function variablesOf(rule: Rule, client: Candidate) {
  return {
    имя: client.name.trim().split(/\s+/)[0] ?? client.name,
    практика: rule.practiceName,
    ...formatMeeting(client.startsAt, rule.timezone),
    баланс: String(client.credits),
    ссылка: practicePageUrl(rule.slug),
    кабинет: cabinetUrl(),
  } satisfies Record<WorkflowVariable, string>;
}

async function sendOne(
  db: Database,
  deliver: Deliver,
  rule: Rule,
  client: Candidate,
) {
  const claim = await claimNotice(db, client.key, client.userId);
  if (!claim) return;
  try {
    const values = variablesOf(rule, client);
    const subject = renderWorkflowText(rule.subject, values)
      .replace(/\s+/g, " ")
      .trim();
    await deliver({
      template: "workflow-message",
      to: [client.email],
      subject,
      props: {
        practiceName: rule.practiceName,
        title: subject,
        text: renderWorkflowText(rule.text, values),
      },
    });
  } catch (error) {
    await claim.release();
    logger.warn("workflow.message_failed", {
      workflowId: rule.id,
      key: client.key,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  await claim.done();
}

async function runRule(db: Database, deliver: Deliver, rule: Rule, now: Date) {
  const hour = localHour(now, rule.timezone);
  if (hour < DAY_HOURS.from || hour >= DAY_HOURS.until) return;

  let afterId: string | undefined;
  while (true) {
    const page = await QUERIES[rule.trigger](db, rule, now, afterId);
    // The window keeps already mailed clients in the query for a while.
    const sent = page.length
      ? await db
          .select({ key: SentNotice.key })
          .from(SentNotice)
          .where(
            and(
              inArray(
                SentNotice.key,
                page.map((client) => client.key),
              ),
              isNotNull(SentNotice.sentAt),
            ),
          )
      : [];
    const done = new Set(sent.map((row) => row.key));
    for (const client of page) {
      if (!done.has(client.key)) await sendOne(db, deliver, rule, client);
    }

    const last = page.at(-1);
    if (!last || page.length < MAX_BATCH) break;
    afterId = last.cursor;
  }
}

/**
 * Mail every message the practices' rules have due. One rule failing (a bad
 * time zone, a query error) is logged and does not stop the others.
 */
export async function sendWorkflowMessages(
  db: Database,
  deliver: Deliver = dispatchEmail,
  now = new Date(),
) {
  for (const rule of await activeRules(db, now)) {
    try {
      await runRule(db, deliver, rule, now);
    } catch (error) {
      logger.warn("workflow.rule_failed", {
        workflowId: rule.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

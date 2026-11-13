import { env, logger } from "@synoro/config";
import {
  and,
  asc,
  type Database,
  eq,
  gt,
  isNotNull,
  isNull,
  notLike,
  or,
  Practice,
  SentNotice,
  SignIn,
  SubscriptionPayment,
  sql,
  user,
} from "@synoro/db";

import { claimNotice } from "./notice-claims";

/**
 * Yandex Direct is paid per paying customer (docs/direct.md): the first paid
 * year, and separately the first paid month, of a specialist who came from an
 * ad goes back to Metrika as an offline conversion, matched to the visit by
 * the Direct click (`yclid`) or, failing that, the Metrika visitor id. In
 * Metrika the goals `paid_year` and `paid_month` are JavaScript-event goals
 * with the condition "matches"; Direct optimizes for them.
 *
 * Only the FIRST paid period of a kind counts: a later year or month (a
 * renewal, auto-renewal included) is the same customer, not a new one. The two
 * kinds are counted apart: a month followed by a year is two conversions, each
 * for its own goal. Refunds, the demo stand and Точка's sandbox never count.
 *
 * The bank settles payments in a webhook, long after the browser is gone, so
 * an hourly cron looks for them (`reportPaidConversions`). A conversion goes
 * out once: each is claimed in `sent_notices` like a mail (`claimNotice`).
 *
 * A payment comes weeks after the click, too late and too rarely for Direct's
 * strategy to learn from. So the same cron reports an earlier step as the goal
 * `practice_created`: a specialist who came from an ad created their first
 * practice (`reportCreatedPractices`). It is a real sign-up, unlike the
 * landing's `signup_free`, which is only a click on the button.
 */

export const PAID_YEAR_GOAL = "paid_year";
export const PAID_MONTH_GOAL = "paid_month";
export const PRACTICE_CREATED_GOAL = "practice_created";

/** The demo stand's accounts (`DEMO_DOMAIN` in `@synoro/auth/demo`). */
const DEMO_EMAILS = "%@example.com";

type Period = "month" | "year";

/** Key of a payment's claim in `sent_notices`: this prefix + the payment id. */
const claimPrefix = (goal: string) => `metrika:${goal}:`;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A payment is retried (after a failed upload) for this long. */
const RETRY_MS = 14 * DAY_MS;
const BATCH = 50;
const API = "https://api-metrika.yandex.net/management/v1/counter";

/** Metrika matches a conversion to a Direct click for 21 days. */
const YCLID_MATCH_MS = 21 * DAY_MS;

export interface Conversion {
  /** The Direct click, preferred: it ties the payment to the ad itself. */
  yclid: string | null;
  /** When the click happened; null: not recorded, taken as recent. */
  yclidAt: Date | null;
  /** The Metrika visitor (`_ym_uid`), used when there is no `yclid`. */
  ymClientId: string | null;
  target: string;
  /** When it happened: the payment, or the practice's creation. */
  paidAt: Date;
  /** Kopecks, RUB; null: the conversion carries no money. */
  amount: number | null;
}

/**
 * The upload file: a header and one row. Metrika reads the identifier's kind
 * from the column name. `DateTime` is Unix seconds and must be in the past.
 * The click goes first, unless it is too old to be matched and the visitor id
 * can stand in.
 */
export function conversionCsv(conversion: Conversion, now = new Date()) {
  const stale =
    !!conversion.yclidAt &&
    now.getTime() - conversion.yclidAt.getTime() > YCLID_MATCH_MS;
  const [idColumn, id] =
    conversion.yclid && !(stale && conversion.ymClientId)
      ? ["Yclid", conversion.yclid]
      : ["ClientId", conversion.ymClientId];
  if (!id) throw new Error("A conversion needs a yclid or a Metrika client id");
  const seconds = Math.floor(conversion.paidAt.getTime() / 1000);
  if (conversion.amount === null) {
    return `${idColumn},Target,DateTime\n${id},${conversion.target},${seconds}\n`;
  }
  const price = (conversion.amount / 100).toFixed(2);
  return `${idColumn},Target,DateTime,Price,Currency\n${id},${conversion.target},${seconds},${price},RUB\n`;
}

/** Sends one conversion to the counter; throws when Metrika refuses it. */
async function uploadConversion(
  counterId: number,
  token: string,
  now: Date,
  conversion: Conversion,
) {
  const body = new FormData();
  body.set(
    "file",
    new Blob([conversionCsv(conversion, now)], { type: "text/csv" }),
    "conversions.csv",
  );
  const response = await fetch(
    `${API}/${counterId}/offline_conversions/upload`,
    {
      method: "POST",
      headers: { Authorization: `OAuth ${token}` },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Metrika answered ${response.status}`);
  }
  const answer = (await response.json().catch(() => null)) as {
    uploading?: { id?: number; status?: string };
  } | null;
  return answer?.uploading;
}

/**
 * Payments for `period` from the last two weeks that came from an ad and are
 * the user's first of that period, except those already sent (`sent_notices`).
 */
function candidates(db: Database, now: Date, period: Period, goal: string) {
  return db
    .select({
      id: SubscriptionPayment.id,
      userId: SubscriptionPayment.userId,
      yclid: SubscriptionPayment.yclid,
      yclidAt: SubscriptionPayment.yclidAt,
      ymClientId: SubscriptionPayment.ymClientId,
      amount: SubscriptionPayment.amount,
      paidAt: SubscriptionPayment.paidAt,
    })
    .from(SubscriptionPayment)
    .where(
      and(
        eq(SubscriptionPayment.status, "succeeded"),
        eq(SubscriptionPayment.period, period),
        isNull(SubscriptionPayment.refundedAt),
        // An automatic charge is a renewal, never a new customer.
        isNull(SubscriptionPayment.chargedFor),
        gt(SubscriptionPayment.paidAt, new Date(now.getTime() - RETRY_MS)),
        or(
          isNotNull(SubscriptionPayment.yclid),
          isNotNull(SubscriptionPayment.ymClientId),
        ),
        // The demo stand and Точка's sandbox have no real money.
        notLike(SubscriptionPayment.externalId, "demo-%"),
        notLike(SubscriptionPayment.externalId, "sandbox-%"),
        sql`not exists (
          select 1 from subscription_payments earlier
          where earlier.user_id = ${SubscriptionPayment.userId}
            and earlier.period = ${period}
            and earlier.status = 'succeeded'
            and earlier.refunded_at is null
            and earlier.paid_at < ${SubscriptionPayment.paidAt}
        )`,
        // Sent ones must not fill the batch and starve the later payments.
        sql`not exists (
          select 1 from sent_notices
          where ${SentNotice.key} = ${claimPrefix(goal)} || ${SubscriptionPayment.id}::text
            and ${SentNotice.sentAt} is not null
        )`,
      ),
    )
    .orderBy(asc(SubscriptionPayment.paidAt))
    .limit(BATCH);
}

/**
 * Upload the conversions of one kind that are due. Does nothing without
 * METRIKA_COUNTER_ID and METRIKA_OAUTH_TOKEN. A failed upload gives its claim
 * back, so the next run tries again until the payment is two weeks old.
 */
async function reportFirstPayments(
  db: Database,
  now: Date,
  period: Period,
  goal: string,
) {
  const counterId = env.METRIKA_COUNTER_ID;
  const token = env.METRIKA_OAUTH_TOKEN;
  if (!counterId || !token) return { sent: 0 };

  let sent = 0;
  for (const payment of await candidates(db, now, period, goal)) {
    // No user: the account was deleted, and its ad click with it.
    if (!payment.paidAt || !payment.userId) continue;
    const claim = await claimNotice(
      db,
      `${claimPrefix(goal)}${payment.id}`,
      payment.userId,
    );
    if (!claim) continue;

    try {
      const uploading = await uploadConversion(counterId, token, now, {
        yclid: payment.yclid,
        yclidAt: payment.yclidAt,
        ymClientId: payment.ymClientId,
        target: goal,
        paidAt: payment.paidAt,
        amount: payment.amount,
      });
      await claim.done();
      sent += 1;
      logger.info("metrika.conversion_sent", {
        paymentId: payment.id,
        goal,
        uploadId: uploading?.id,
        by: payment.yclid ? "yclid" : "client_id",
      });
    } catch (error) {
      await claim.release();
      logger.warn("metrika.conversion_failed", {
        paymentId: payment.id,
        goal,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sent };
}

/** The first paid year of each customer who came from an ad: `paid_year`. */
export const reportPaidYears = (db: Database, now = new Date()) =>
  reportFirstPayments(db, now, "year", PAID_YEAR_GOAL);

/** The first paid month of each customer who came from an ad: `paid_month`. */
export const reportPaidMonths = (db: Database, now = new Date()) =>
  reportFirstPayments(db, now, "month", PAID_MONTH_GOAL);

/**
 * First practices from the last two weeks whose owner came from an ad, except
 * those already sent. The click is the one on the owner's last sign-in before
 * the practice appeared (`sign_ins`, written from the landing's cookie); an
 * admin's impersonation is not the owner's visit.
 */
function createdPractices(db: Database, now: Date) {
  return db
    .select({
      id: Practice.id,
      userId: Practice.ownerId,
      createdAt: Practice.createdAt,
      yclid: SignIn.yclid,
      yclidAt: SignIn.yclidAt,
    })
    .from(Practice)
    .innerJoin(user, eq(user.id, Practice.ownerId))
    .innerJoin(
      SignIn,
      sql`${SignIn.id} = (
        select latest.id from sign_ins latest
        where latest.user_id = ${Practice.ownerId}
          and latest.impersonated_by is null
          and latest.created_at <= ${Practice.createdAt}
        order by latest.created_at desc
        limit 1
      )`,
    )
    .where(
      and(
        gt(Practice.createdAt, new Date(now.getTime() - RETRY_MS)),
        notLike(user.email, DEMO_EMAILS),
        isNotNull(SignIn.yclid),
        // A second practice is the same specialist, not a new one.
        sql`not exists (
          select 1 from practices earlier
          where earlier.owner_id = ${Practice.ownerId}
            and earlier.created_at < ${Practice.createdAt}
        )`,
        sql`not exists (
          select 1 from sent_notices
          where ${SentNotice.key} = ${claimPrefix(PRACTICE_CREATED_GOAL)} || ${Practice.id}::text
            and ${SentNotice.sentAt} is not null
        )`,
      ),
    )
    .orderBy(asc(Practice.createdAt))
    .limit(BATCH);
}

/**
 * The first practice of each specialist who came from an ad:
 * `practice_created`, matched by the click only (a sign-in keeps no Metrika
 * visitor id). Claims and retries work as for the payments.
 */
export async function reportCreatedPractices(db: Database, now = new Date()) {
  const counterId = env.METRIKA_COUNTER_ID;
  const token = env.METRIKA_OAUTH_TOKEN;
  if (!counterId || !token) return { sent: 0 };

  let sent = 0;
  for (const practice of await createdPractices(db, now)) {
    const claim = await claimNotice(
      db,
      `${claimPrefix(PRACTICE_CREATED_GOAL)}${practice.id}`,
      practice.userId,
    );
    if (!claim) continue;

    try {
      const uploading = await uploadConversion(counterId, token, now, {
        yclid: practice.yclid,
        yclidAt: practice.yclidAt,
        ymClientId: null,
        target: PRACTICE_CREATED_GOAL,
        paidAt: practice.createdAt,
        amount: null,
      });
      await claim.done();
      sent += 1;
      logger.info("metrika.conversion_sent", {
        practiceId: practice.id,
        goal: PRACTICE_CREATED_GOAL,
        uploadId: uploading?.id,
        by: "yclid",
      });
    } catch (error) {
      await claim.release();
      logger.warn("metrika.conversion_failed", {
        practiceId: practice.id,
        goal: PRACTICE_CREATED_GOAL,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sent };
}

/**
 * Every kind, for the hourly cron. One kind failing (the lookup or a claim
 * threw) must not hold the others back, so all run; the first error is then
 * thrown again, for the task's own retry.
 */
export async function reportPaidConversions(db: Database, now = new Date()) {
  let sent = 0;
  let failure: { error: unknown } | undefined;
  for (const [kind, report] of [
    ["year", reportPaidYears],
    ["month", reportPaidMonths],
    ["practice", reportCreatedPractices],
  ] as const) {
    try {
      sent += (await report(db, now)).sent;
    } catch (error) {
      failure ??= { error };
      logger.warn("metrika.report_failed", {
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (failure) throw failure.error;
  return { sent };
}

import { env, logger } from "@synoro/config";
import {
  and,
  asc,
  type BillingPeriod,
  type Database,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  notLike,
  or,
  SentNotice,
  Subscription,
  SubscriptionAutorenewal,
  SubscriptionPayment,
  sql,
  user,
} from "@synoro/db";
import type { RenewalNotice } from "@synoro/emails";
import { PRO_PRICES } from "@synoro/validators";

import { cancelAutorenewal, settleSubscriptionPayment } from "./billing";
import type { Deliver } from "./booking-video";
import { dispatchEmail } from "./index";
import { claimNotice } from "./notice-claims";
import { billingUrl, formatEnd, rubles } from "./pro-notices";

/**
 * Auto-renewal of «Про» (docs/billing.md): shortly before `paid_until` the
 * card the specialist agreed to charge is charged for the next period through
 * Точка's `POST /acquiring/v1.0/subscriptions/{operationId}/charge`, and the
 * payment is settled like any other (`settleSubscriptionPayment`).
 *
 * Charging twice, or after the specialist said stop, is the one thing that
 * must not happen. So an attempt is a row first: `subscription_payments` with
 * `charged_for = paid_until`, unique per user, inserted BEFORE the bank is
 * called — in the same statement that re-checks, with the rows locked, that
 * the renewal is still on, still due for this very `paid_until` and not tried
 * within the last 12 hours (`claimAttempt`). A second worker, a retry of the
 * workflow, a cancellation or a manual payment racing the first, or a crash
 * after the charge, can't get a second charge out of it. Only a definite
 * refusal frees the period for another attempt.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A period is renewed up to a day before it ends… */
const AHEAD_MS = DAY_MS;
/** …and still after it ended, if the worker was down (then it starts now). */
const GRACE_MS = 3 * DAY_MS;
/** Time between declined attempts: three tries fit before the period ends. */
const RETRY_MS = 12 * HOUR_MS;
const MAX_ATTEMPTS = 3;
const BATCH = 100;
/** A mail about a charge is still delivered (and retried) this long after. */
const NOTICE_MS = 3 * DAY_MS;

/**
 * charged  — the bank said `result: true`.
 * declined — the bank refused: the card, the subscription, the amount.
 * not_sent — nothing went out (no key, key rejected, rate limit).
 * unknown  — no answer or one we can't read: the money may have moved.
 */
type Charge = "charged" | "declined" | "not_sent" | "unknown";

/**
 * The response is `{ Data: { result: boolean } }`; the collection doesn't
 * describe an error body, so any 4xx other than auth / rate limit is read as
 * a refusal, and anything we can't classify as "may have been charged".
 */
async function chargeTochka(
  operationId: string,
  amount: number,
): Promise<Charge> {
  const token = env.TOCHKA_API_TOKEN;
  if (!token) return "not_sent";
  let response: Response;
  try {
    response = await fetch(
      `${env.TOCHKA_API_URL}/acquiring/v1.0/subscriptions/${encodeURIComponent(operationId)}/charge`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ Data: { amount: amount / 100 } }),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    return "unknown";
  }
  const { status } = response;
  if (status === 401 || status === 403 || status === 429) return "not_sent";
  if (status >= 500 || status === 424) return "unknown";
  if (!response.ok) return "declined";
  const body = (await response.json().catch(() => null)) as {
    Data?: { result?: unknown };
  } | null;
  if (body?.Data?.result === true) return "charged";
  return body?.Data?.result === false ? "declined" : "unknown";
}

/** Auto-renewals whose paid period ends within a day, by id. */
function candidates(db: Database, now: Date, afterId: string | undefined) {
  return db
    .select({
      id: SubscriptionAutorenewal.id,
      userId: SubscriptionAutorenewal.userId,
      externalId: SubscriptionAutorenewal.externalId,
      period: SubscriptionAutorenewal.period,
      lastAttemptAt: SubscriptionAutorenewal.lastAttemptAt,
      paidUntil: Subscription.paidUntil,
    })
    .from(SubscriptionAutorenewal)
    .innerJoin(
      Subscription,
      eq(Subscription.userId, SubscriptionAutorenewal.userId),
    )
    .where(
      and(
        eq(SubscriptionAutorenewal.status, "active"),
        // The demo stand and Точка's sandbox have no card to charge.
        notLike(SubscriptionAutorenewal.externalId, "demo-%"),
        notLike(SubscriptionAutorenewal.externalId, "sandbox-%"),
        isNotNull(Subscription.paidUntil),
        lte(Subscription.paidUntil, new Date(now.getTime() + AHEAD_MS)),
        gt(Subscription.paidUntil, new Date(now.getTime() - GRACE_MS)),
        or(
          isNull(SubscriptionAutorenewal.lastAttemptAt),
          lte(
            SubscriptionAutorenewal.lastAttemptAt,
            new Date(now.getTime() - RETRY_MS),
          ),
        ),
        afterId ? gt(SubscriptionAutorenewal.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(SubscriptionAutorenewal.id))
    .limit(BATCH);
}

type Candidate = Awaited<ReturnType<typeof candidates>>[number];

/**
 * Take the right to charge `paidUntil` of this renewal, or undefined if it
 * is gone. One statement: with the renewal and subscription rows locked, it
 * checks that the renewal is still on, for the same bank subscription, that
 * `paid_until` is still the one picked (a manual payment moves it), and that
 * the last attempt is old enough — whatever a racing worker, a cancellation
 * or a payment did since the candidates were read — then marks the attempt
 * time and inserts the attempt row. The row's unique `(user_id, charged_for)`
 * turns away a repeat of the same period.
 */
async function claimAttempt(
  db: Database,
  row: Candidate & { paidUntil: Date },
  amount: number,
  now: Date,
) {
  const paidUntil = row.paidUntil.toISOString();
  const retryBefore = new Date(now.getTime() - RETRY_MS).toISOString();
  const result: unknown = await db.execute(sql`
    with target as (
      select r.id, r.user_id, r.period
      from subscription_autorenewals r
      join subscriptions s on s.user_id = r.user_id
      where r.id = ${row.id} and r.status = 'active'
        and r.external_id = ${row.externalId}
        and s.paid_until >= ${paidUntil}::timestamptz
        and s.paid_until < ${paidUntil}::timestamptz + interval '1 millisecond'
        and (r.last_attempt_at is null
          or r.last_attempt_at <= ${retryBefore}::timestamptz)
      for update of r, s
    ), touched as (
      update subscription_autorenewals r
      set last_attempt_at = ${now.toISOString()}::timestamptz,
          updated_at = now()
      from target
      where r.id = target.id
    )
    insert into subscription_payments (user_id, period, amount, charged_for)
    select user_id, period, ${amount}, ${paidUntil}::timestamptz from target
    on conflict (user_id, charged_for) do nothing
    returning id
  `);
  return (result as { rows: { id: string }[] }).rows[0]?.id;
}

async function renew(db: Database, row: Candidate, now: Date) {
  const { paidUntil } = row;
  if (!paidUntil) return;
  const amount = PRO_PRICES[row.period].amount;

  const attemptId = await claimAttempt(db, { ...row, paidUntil }, amount, now);
  if (!attemptId) return;

  const outcome = await chargeTochka(row.externalId, amount);
  const log = { userId: row.userId, paymentId: attemptId, amount };

  if (outcome === "charged") {
    let settled: Awaited<ReturnType<typeof settleSubscriptionPayment>>;
    try {
      settled = await settleSubscriptionPayment(db, attemptId, "succeeded");
    } catch (error) {
      // The money has moved but the period isn't recorded: a human must.
      logger.error("billing.renewal_unrecorded", error, log);
      return;
    }
    if (settled.status !== "succeeded" || !settled.periodEnd) {
      logger.error("billing.renewal_unrecorded", undefined, log);
      return;
    }
    await db
      .update(SubscriptionAutorenewal)
      .set({ failedAttempts: 0 })
      .where(eq(SubscriptionAutorenewal.id, row.id));
    logger.info("billing.renewed", log);
  } else if (outcome === "declined") {
    // Count the failure, then free the period for the next try. The mail the
    // specialist is owed is recorded on the payment (`decline_kind`).
    const [counted] = await db
      .update(SubscriptionAutorenewal)
      .set({
        failedAttempts: sql`${SubscriptionAutorenewal.failedAttempts} + 1`,
      })
      .where(eq(SubscriptionAutorenewal.id, row.id))
      .returning({ failedAttempts: SubscriptionAutorenewal.failedAttempts });
    const final = (counted?.failedAttempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;
    if (final) await cancelAutorenewal(db, row.userId, "charge_failed");
    await db
      .update(SubscriptionPayment)
      .set({
        status: "canceled",
        chargedFor: null,
        declineKind: final ? "final" : "retry",
      })
      .where(
        and(
          eq(SubscriptionPayment.id, attemptId),
          eq(SubscriptionPayment.status, "pending"),
        ),
      );
    logger.warn("billing.renewal_declined", { ...log, final });
  } else if (outcome === "not_sent") {
    // Nothing reached the bank: forget the attempt, and let the next run try
    // again at once instead of after the 12 hours that follow a refusal.
    await db
      .delete(SubscriptionPayment)
      .where(
        and(
          eq(SubscriptionPayment.id, attemptId),
          eq(SubscriptionPayment.status, "pending"),
        ),
      );
    await db
      .update(SubscriptionAutorenewal)
      .set({ lastAttemptAt: row.lastAttemptAt })
      .where(eq(SubscriptionAutorenewal.id, row.id));
    logger.error("billing.renewal_not_sent", undefined, log);
  } else {
    // No clear answer: the card may have been charged. The attempt stays
    // pending, which blocks another charge of this period until someone
    // checks the bank and settles or deletes it (docs/billing.md).
    logger.error("billing.renewal_unconfirmed", undefined, log);
  }
}

const periodLabel = (period: BillingPeriod) =>
  period === "year" ? "год" : "месяц";

const SUBJECTS: Record<RenewalNotice, string> = {
  charged: "«Про» продлён",
  failed: "Не удалось продлить «Про» — проверьте карту",
  canceled: "Автопродление «Про» отключено",
};

/**
 * Mail the specialist about each recent automatic charge: charged, declined
 * (will retry) or declined for the last time. Works from the payments, not
 * from the subscriptions due for a charge, so a mail whose delivery failed
 * is retried by the next runs for three days. One mail per payment: a claim
 * in `sent_notices` (key `renewal:<paymentId>`) keeps repeats out.
 */
async function sendRenewalNotices(db: Database, deliver: Deliver, now: Date) {
  const rows = await db
    .select({
      id: SubscriptionPayment.id,
      status: SubscriptionPayment.status,
      declineKind: SubscriptionPayment.declineKind,
      period: SubscriptionPayment.period,
      amount: SubscriptionPayment.amount,
      periodStart: SubscriptionPayment.periodStart,
      periodEnd: SubscriptionPayment.periodEnd,
      userId: SubscriptionPayment.userId,
      paidUntil: Subscription.paidUntil,
      name: user.name,
      email: user.email,
    })
    .from(SubscriptionPayment)
    .innerJoin(
      Subscription,
      eq(Subscription.userId, SubscriptionPayment.userId),
    )
    .innerJoin(user, eq(user.id, SubscriptionPayment.userId))
    .where(
      and(
        gt(SubscriptionPayment.createdAt, new Date(now.getTime() - NOTICE_MS)),
        or(
          and(
            eq(SubscriptionPayment.status, "succeeded"),
            isNotNull(SubscriptionPayment.chargedFor),
          ),
          isNotNull(SubscriptionPayment.declineKind),
        ),
        sql`not exists (
          select 1 from ${SentNotice}
          where ${SentNotice.key} = 'renewal:' || ${SubscriptionPayment.id}
            and ${SentNotice.sentAt} is not null
        )`,
      ),
    )
    .orderBy(asc(SubscriptionPayment.createdAt))
    .limit(BATCH);

  for (const row of rows) {
    const notice: RenewalNotice =
      row.status === "succeeded"
        ? "charged"
        : row.declineKind === "final"
          ? "canceled"
          : "failed";
    const claim = await claimNotice(db, `renewal:${row.id}`, row.userId);
    if (!claim) continue;
    const endsOn = notice === "charged" ? row.periodStart : row.paidUntil;
    try {
      await deliver({
        template: "renewal-notice",
        to: [row.email],
        subject: SUBJECTS[notice],
        props: {
          notice,
          name: row.name,
          amount: rubles(row.amount),
          period: periodLabel(row.period),
          until: row.periodEnd ? formatEnd(row.periodEnd) : "",
          endsOn: endsOn ? formatEnd(endsOn) : "",
          billingUrl: billingUrl(),
        },
      });
    } catch (error) {
      await claim.release();
      logger.warn("billing.renewal_notice_failed", {
        userId: row.userId,
        paymentId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    await claim.done();
  }
}

/**
 * Charge every auto-renewal whose paid period ends within a day, then mail
 * about the charges. Charges nothing in the sandbox or without a key: there
 * is no card to charge.
 */
export async function renewSubscriptions(
  db: Database,
  deliver: Deliver = dispatchEmail,
  now = new Date(),
) {
  if (!env.TOCHKA_SANDBOX && env.TOCHKA_API_TOKEN) {
    let afterId: string | undefined;
    while (true) {
      const rows = await candidates(db, now, afterId);
      for (const row of rows) {
        try {
          await renew(db, row, now);
        } catch (error) {
          // One failing user must not stop the others.
          logger.error("billing.renewal_failed", error, {
            userId: row.userId,
          });
        }
      }
      const last = rows.at(-1);
      if (!last || rows.length < BATCH) break;
      afterId = last.id;
    }
  }
  await sendRenewalNotices(db, deliver, now);
}

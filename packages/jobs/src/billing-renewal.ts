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
 * Charging twice is the one thing that must not happen, so an attempt is a
 * row first: `subscription_payments` with `charged_for = paid_until`, unique
 * per user, inserted BEFORE the bank is called. A second worker, a retry of
 * the workflow or a crash after the charge finds the row and skips that
 * period. Only a definite refusal frees the period for another attempt.
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
      paidUntil: Subscription.paidUntil,
      name: user.name,
      email: user.email,
    })
    .from(SubscriptionAutorenewal)
    .innerJoin(
      Subscription,
      eq(Subscription.userId, SubscriptionAutorenewal.userId),
    )
    .innerJoin(user, eq(user.id, SubscriptionAutorenewal.userId))
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

const periodLabel = (period: BillingPeriod) =>
  period === "year" ? "год" : "месяц";

/** Tell the specialist about an attempt, once per payment (`sent_notices`). */
async function notify(
  db: Database,
  deliver: Deliver,
  row: Candidate,
  paymentId: string,
  notice: RenewalNotice,
  subject: string,
  paidUntil: Date,
  newEnd?: Date,
) {
  const claim = await claimNotice(
    db,
    `renewal:${notice}:${paymentId}`,
    row.userId,
  );
  if (!claim) return;
  try {
    await deliver({
      template: "renewal-notice",
      to: [row.email],
      subject,
      props: {
        notice,
        name: row.name,
        amount: rubles(PRO_PRICES[row.period].amount),
        period: periodLabel(row.period),
        until: newEnd ? formatEnd(newEnd) : "",
        endsOn: formatEnd(paidUntil),
        billingUrl: billingUrl(),
      },
    });
  } catch (error) {
    await claim.release();
    logger.warn("billing.renewal_notice_failed", {
      userId: row.userId,
      paymentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  await claim.done();
}

async function renew(
  db: Database,
  deliver: Deliver,
  row: Candidate,
  now: Date,
) {
  const { paidUntil } = row;
  if (!paidUntil) return;
  const amount = PRO_PRICES[row.period].amount;

  // The claim: one attempt row per user and period end, before the bank.
  const [attempt] = await db
    .insert(SubscriptionPayment)
    .values({
      userId: row.userId,
      period: row.period,
      amount,
      chargedFor: paidUntil,
    })
    .onConflictDoNothing({
      target: [SubscriptionPayment.userId, SubscriptionPayment.chargedFor],
    })
    .returning({ id: SubscriptionPayment.id });
  if (!attempt) return;

  await db
    .update(SubscriptionAutorenewal)
    .set({ lastAttemptAt: now })
    .where(eq(SubscriptionAutorenewal.id, row.id));

  const outcome = await chargeTochka(row.externalId, amount);
  const log = { userId: row.userId, paymentId: attempt.id, amount };

  if (outcome === "charged") {
    let settled: Awaited<ReturnType<typeof settleSubscriptionPayment>>;
    try {
      settled = await settleSubscriptionPayment(db, attempt.id, "succeeded");
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
    await notify(
      db,
      deliver,
      row,
      attempt.id,
      "charged",
      "«Про» продлён",
      paidUntil,
      settled.periodEnd,
    );
  } else if (outcome === "declined") {
    // Free the period for the next try, and count the failure.
    await db
      .update(SubscriptionPayment)
      .set({ status: "canceled", chargedFor: null })
      .where(
        and(
          eq(SubscriptionPayment.id, attempt.id),
          eq(SubscriptionPayment.status, "pending"),
        ),
      );
    const [counted] = await db
      .update(SubscriptionAutorenewal)
      .set({
        failedAttempts: sql`${SubscriptionAutorenewal.failedAttempts} + 1`,
      })
      .where(eq(SubscriptionAutorenewal.id, row.id))
      .returning({ failedAttempts: SubscriptionAutorenewal.failedAttempts });
    const final = (counted?.failedAttempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;
    if (final) await cancelAutorenewal(db, row.userId, "charge_failed");
    logger.warn("billing.renewal_declined", { ...log, final });
    await notify(
      db,
      deliver,
      row,
      attempt.id,
      final ? "canceled" : "failed",
      final
        ? "Автопродление «Про» отключено"
        : "Не удалось продлить «Про» — проверьте карту",
      paidUntil,
    );
  } else if (outcome === "not_sent") {
    // Nothing reached the bank: forget the attempt, try again next run.
    await db
      .delete(SubscriptionPayment)
      .where(
        and(
          eq(SubscriptionPayment.id, attempt.id),
          eq(SubscriptionPayment.status, "pending"),
        ),
      );
    logger.error("billing.renewal_not_sent", undefined, log);
  } else {
    // No clear answer: the card may have been charged. The attempt stays
    // pending, which blocks another charge of this period until someone
    // checks the bank and settles or deletes it (docs/billing.md).
    logger.error("billing.renewal_unconfirmed", undefined, log);
  }
}

/**
 * Charge every auto-renewal whose paid period ends within a day. Does
 * nothing in the sandbox or without a key: there is no card to charge.
 */
export async function renewSubscriptions(
  db: Database,
  deliver: Deliver = dispatchEmail,
  now = new Date(),
) {
  if (env.TOCHKA_SANDBOX || !env.TOCHKA_API_TOKEN) return;

  let afterId: string | undefined;
  while (true) {
    const rows = await candidates(db, now, afterId);
    for (const row of rows) {
      try {
        await renew(db, deliver, row, now);
      } catch (error) {
        // One failing user must not stop the others.
        logger.error("billing.renewal_failed", error, { userId: row.userId });
      }
    }
    const last = rows.at(-1);
    if (!last || rows.length < BATCH) break;
    afterId = last.id;
  }
}

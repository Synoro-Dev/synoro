import { env, logger, paths } from "@synoro/config";
import {
  type BillingPeriod,
  type Database,
  eq,
  type PaymentStatus,
  Subscription,
  SubscriptionPayment,
  sql,
} from "@synoro/db";
import { PRO_PRICES, TRIAL_DAYS } from "@synoro/validators";

import { ProviderError } from "../payments/types";
import {
  createTochkaPayment,
  fetchTochkaPayment,
  tochkaAvailable,
  tochkaWebhookOperationId,
} from "./tochka";

type SubscriptionRow = typeof Subscription.$inferSelect;
type SubscriptionPaymentRow = typeof SubscriptionPayment.$inferSelect;

/**
 * none    — never had «Про»: no practice yet, so no trial either.
 * trial   — inside the free 14 days, nothing paid yet.
 * active  — paid up to `activeUntil` (even if bought during the trial).
 * expired — trial and paid periods are over: the free plan.
 */
type PlanStatus = "none" | "trial" | "active" | "expired";

export function planOf(row: SubscriptionRow | undefined, now = new Date()) {
  if (!row) {
    return {
      status: "none" as PlanStatus,
      pro: false,
      trialEndsAt: null,
      paidUntil: null,
      activeUntil: null,
    };
  }
  const paidUntil = row.paidUntil;
  const activeUntil =
    paidUntil && paidUntil > row.trialEndsAt ? paidUntil : row.trialEndsAt;
  const status: PlanStatus =
    paidUntil && paidUntil > now
      ? "active"
      : row.trialEndsAt > now
        ? "trial"
        : "expired";
  return {
    status,
    pro: activeUntil > now,
    trialEndsAt: row.trialEndsAt,
    paidUntil,
    activeUntil,
  };
}

export function findSubscription(db: Database, userId: string) {
  return db.query.Subscription.findFirst({
    where: eq(Subscription.userId, userId),
  });
}

/** Whether the user (a practice owner) is on «Про» right now. */
export async function hasPro(db: Database, userId: string) {
  return planOf(await findSubscription(db, userId)).pro;
}

/**
 * Start the 14-day trial — once per user: with their first practice, or the
 * first payment if that comes earlier. Later calls change nothing.
 */
export async function ensureSubscription(db: Database, userId: string) {
  await db
    .insert(Subscription)
    .values({
      userId,
      trialEndsAt: sql`now() + make_interval(days => ${TRIAL_DAYS})`,
    })
    .onConflictDoNothing({ target: Subscription.userId });
}

/** Where Точка sends the specialist back: the billing page, which checks it. */
function billingReturnUrl(paymentId: string) {
  const url = new URL(paths.settings.billing, env.APP_URL);
  url.searchParams.set("payment", paymentId);
  return url.href;
}

/**
 * The demo stand (DEMO_LOGIN_EMAIL) has no bank behind it: a «Про» payment
 * there is paid the moment it starts, like payments to `demo-` shops.
 */
function isDemoBilling() {
  return !!env.DEMO_LOGIN_EMAIL && !tochkaAvailable();
}

/** «Про» can be paid for on this deployment. */
export function billingAvailable() {
  return (tochkaAvailable() && !!env.TOCHKA_TAX_SYSTEM) || isDemoBilling();
}

/**
 * Create a pending payment for a month or a year of «Про» and open a Точка
 * payment link for it. Throws `ProviderError` when the bank refuses; the
 * row is then dropped, since nothing was charged.
 */
export async function startSubscriptionPayment(
  db: Database,
  input: { user: { id: string; email: string }; period: BillingPeriod },
) {
  const price = PRO_PRICES[input.period];
  await ensureSubscription(db, input.user.id);
  const [payment] = await db
    .insert(SubscriptionPayment)
    .values({
      userId: input.user.id,
      period: input.period,
      amount: price.amount,
    })
    .returning();
  if (!payment) throw new Error("Failed to insert subscription payment");

  if (isDemoBilling()) {
    await db
      .update(SubscriptionPayment)
      .set({ externalId: `demo-${payment.id}` })
      .where(eq(SubscriptionPayment.id, payment.id));
    await settleSubscriptionPayment(db, payment.id, "succeeded");
    return {
      paymentId: payment.id,
      confirmationUrl: billingReturnUrl(payment.id),
    };
  }

  const term = input.period === "year" ? "12 месяцев" : "1 месяц";
  try {
    const remote = await createTochkaPayment({
      orderId: payment.id,
      amount: price.amount,
      purpose: `Оплата тарифа «Про» в Synoro на ${term}`,
      itemName: `Тариф «Про» Synoro, ${term}`,
      email: input.user.email,
      returnUrl: billingReturnUrl(payment.id),
    });
    await db
      .update(SubscriptionPayment)
      .set({
        externalId: remote.externalId,
        confirmationUrl: remote.confirmationUrl,
      })
      .where(eq(SubscriptionPayment.id, payment.id));
    return { paymentId: payment.id, confirmationUrl: remote.confirmationUrl };
  } catch (error) {
    await db
      .delete(SubscriptionPayment)
      .where(eq(SubscriptionPayment.id, payment.id));
    throw error;
  }
}

/**
 * Move a pending «Про» payment to its final status. Success marks it paid
 * and extends `subscriptions.paid_until` by its period in ONE statement:
 * the paid period starts when the current one ends (trial or an earlier
 * payment), or now if «Про» has lapsed. The rows are locked first, so racing
 * webhooks and status checks — or two payments of one user — never add a
 * period twice or lose one. Settled payments never change.
 */
async function settleSubscriptionPayment(
  db: Database,
  paymentId: string,
  status: PaymentStatus,
) {
  if (status === "canceled") {
    await db.execute(sql`
      update subscription_payments
      set status = 'canceled', confirmation_url = null, updated_at = now()
      where id = ${paymentId} and status = 'pending'
    `);
  } else if (status === "succeeded") {
    await db.execute(sql`
      with target as (
        select sp.id, sp.user_id, sp.period,
          greatest(now(), s.trial_ends_at, coalesce(s.paid_until, now()))
            as period_start
        from subscription_payments sp
        join subscriptions s on s.user_id = sp.user_id
        where sp.id = ${paymentId} and sp.status = 'pending'
        for update of sp, s
      ), paid as (
        update subscription_payments sp
        set status = 'succeeded', paid_at = now(), confirmation_url = null,
            period_start = target.period_start,
            period_end = target.period_start + case target.period
              when 'year' then interval '1 year' else interval '1 month' end,
            updated_at = now()
        from target
        where sp.id = target.id
        returning sp.user_id, sp.period_end
      )
      update subscriptions s
      set paid_until = paid.period_end, updated_at = now()
      from paid
      where s.user_id = paid.user_id
    `);
  }

  const payment = await db.query.SubscriptionPayment.findFirst({
    where: eq(SubscriptionPayment.id, paymentId),
  });
  if (!payment) throw new Error(`Subscription payment ${paymentId} vanished`);
  return payment;
}

/**
 * Ask Точка about a pending «Про» payment and settle it. The bank is the
 * source of truth; a webhook only says "look again". When it can't be
 * reached the payment stays pending and is checked next time.
 */
export async function syncSubscriptionPayment(
  db: Database,
  payment: SubscriptionPaymentRow,
) {
  if (payment.status !== "pending" || !payment.externalId) return payment;
  if (!tochkaAvailable()) return payment;

  try {
    const remote = await fetchTochkaPayment(payment.externalId);
    if (remote.status === "pending") return payment;
    if (
      remote.status === "succeeded" &&
      Math.round(remote.amount * 100) !== payment.amount
    ) {
      logger.error("billing.amount_mismatch", {
        paymentId: payment.id,
        expected: payment.amount,
        received: remote.amount,
      });
      return payment;
    }
    const settled = await settleSubscriptionPayment(
      db,
      payment.id,
      remote.status,
    );
    logger.info("billing.settled", {
      paymentId: payment.id,
      status: settled.status,
    });
    return settled;
  } catch (error) {
    logger.warn("billing.sync_failed", {
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof ProviderError) return payment;
    throw error;
  }
}

/**
 * `POST /api/billing/tochka`: Точка's `acquiringInternetPayment` webhook
 * (registered once for the platform's JWT key, see docs/billing.md). The
 * operation is re-read through the API, so a forged body changes nothing.
 * Точка retries anything but 200 thirty times, so unknown operations are
 * acknowledged too; only a failed sync of ours asks for a retry.
 */
export async function handleBillingWebhook(
  request: Request,
  db: Database,
): Promise<globalThis.Response> {
  const operationId = tochkaWebhookOperationId(await request.text());
  const payment =
    operationId &&
    (await db.query.SubscriptionPayment.findFirst({
      where: eq(SubscriptionPayment.externalId, operationId),
    }));
  if (!payment) return new Response("OK");

  const synced = await syncSubscriptionPayment(db, payment);
  return synced.status === "pending"
    ? new Response("Not settled yet", { status: 503 })
    : new Response("OK");
}

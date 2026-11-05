import { env, logger, paths } from "@synoro/config";
import {
  and,
  type BillingPeriod,
  type Database,
  eq,
  type PaymentStatus,
  SlugOrder,
  Subscription,
  SubscriptionAutorenewal,
  SubscriptionPayment,
  sql,
} from "@synoro/db";
import {
  cancelAutorenewal,
  settleSubscriptionPayment,
} from "@synoro/jobs/billing";
import { PRO_PRICES, TRIAL_DAYS } from "@synoro/validators";

import { ProviderError } from "../payments/types";
import type { AdAttribution } from "./attribution";
import { syncSlugOrder } from "./slug-orders";
import {
  createTochkaPayment,
  fetchTochkaPayment,
  isDemoBilling,
  isSandboxPayment,
  refundTochkaPayment,
  sandboxExternalId,
  tochkaAvailable,
  tochkaConfig,
  tochkaSandbox,
  tochkaWebhookOperationId,
} from "./tochka";

export { cancelAutorenewal, isSandboxPayment, tochkaSandbox };

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

/** The user's auto-renewal, while it is on. */
export function findActiveAutorenewal(db: Database, userId: string) {
  return db.query.SubscriptionAutorenewal.findFirst({
    where: and(
      eq(SubscriptionAutorenewal.userId, userId),
      eq(SubscriptionAutorenewal.status, "active"),
    ),
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

/** «Про» can be paid for on this deployment. */
export function billingAvailable() {
  return (tochkaAvailable() && !!tochkaConfig().taxSystem) || isDemoBilling();
}

/**
 * Create a pending payment for a month or a year of «Про» and open a Точка
 * payment link for it. Throws `ProviderError` when the bank refuses; the
 * row is then dropped, since nothing was charged.
 *
 * With `autorenew` (the specialist ticked the consent box) the link is a
 * Точка subscription: once this payment is paid, auto-renewal starts and the
 * `billing-renewals` job charges the card for each next period.
 */
export async function startSubscriptionPayment(
  db: Database,
  input: {
    user: { id: string; email: string };
    period: BillingPeriod;
    autorenew?: boolean;
    /** The ad click and Metrika visitor, see `adAttribution`. */
    attribution?: AdAttribution;
  },
) {
  const price = PRO_PRICES[input.period];
  await ensureSubscription(db, input.user.id);
  const [payment] = await db
    .insert(SubscriptionPayment)
    .values({
      userId: input.user.id,
      period: input.period,
      amount: price.amount,
      autorenewConsentAt: input.autorenew ? new Date() : null,
      yclid: input.attribution?.yclid,
      yclidAt: input.attribution?.yclidAt,
      ymClientId: input.attribution?.ymClientId,
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
      purpose: input.autorenew
        ? `Заказ ${payment.number}. Тариф «Про» Synoro на ${term}, автопродление`
        : `Заказ ${payment.number}. Оплата тарифа «Про» в Synoro на ${term}`,
      itemName: `Тариф «Про» Synoro, ${term}`,
      email: input.user.email,
      returnUrl: billingReturnUrl(payment.id),
      autorenew: input.autorenew,
    });
    // The sandbox answers every request with the same operation and a link
    // nobody can pay: keep only the fact that the request was accepted, and
    // let the billing page confirm the payment (`settleSandboxPayment`).
    const sandbox = tochkaSandbox();
    const confirmationUrl = sandbox
      ? billingReturnUrl(payment.id)
      : remote.confirmationUrl;
    await db
      .update(SubscriptionPayment)
      .set({
        externalId: sandbox ? sandboxExternalId(payment.id) : remote.externalId,
        confirmationUrl,
      })
      .where(eq(SubscriptionPayment.id, payment.id));
    return { paymentId: payment.id, confirmationUrl };
  } catch (error) {
    await db
      .delete(SubscriptionPayment)
      .where(eq(SubscriptionPayment.id, payment.id));
    throw error;
  }
}

/** Payments that never reached a bank (demo stand, Точка's sandbox). */
const BANKLESS_ID = /^(demo|sandbox)-/;

/**
 * Give a paid «Про» payment back, whole: Точка returns the money, then the
 * payment is marked `refunded_at` and `subscriptions.paid_until` drops to the
 * end of the user's latest payment that is still in force (null if none).
 * The payment's and the subscription's rows stay locked from the check to the
 * commit, bank call included, so a webhook settling another payment waits
 * instead of moving `paid_until` under the refund, and two refunds of one
 * payment can't both reach the bank.
 * Only the payment that ends the paid period can go back — otherwise taking
 * its months off would leave a hole before the later ones — so refund the
 * newest first. Throws `ProviderError` when the bank refuses; nothing changes
 * then. A refund also switches the user's auto-renewal off (in the same
 * transaction): it is a sign they don't want to be charged.
 *
 * Точка refunds payments made through a subscription (the one that turned
 * auto-renewal on and every automatic charge) only in the internet bank, so
 * for those `recorded` is required: the money has gone back there already,
 * and only the paid period is taken off here (`bank_only` without it).
 */
export async function refundSubscriptionPayment(
  db: Database,
  paymentId: string,
  options: { recorded?: boolean } = {},
) {
  // Set once the bank has paid the money back; anything that goes wrong after
  // it (the writes, the commit) leaves a refund nobody recorded.
  let bankRefunded: { externalId: string } | undefined;
  try {
    const outcome = await db.transaction(async (tx) => {
      const [found] = await tx
        .select({
          payment: SubscriptionPayment,
          paidUntil: Subscription.paidUntil,
        })
        .from(SubscriptionPayment)
        .innerJoin(
          Subscription,
          eq(Subscription.userId, SubscriptionPayment.userId),
        )
        .where(eq(SubscriptionPayment.id, paymentId))
        .for("update", { of: [SubscriptionPayment, Subscription] });
      if (!found) return { result: "not_found" as const };

      const { payment, paidUntil } = found;
      const { externalId } = payment;
      const viaSubscription =
        !!payment.autorenewConsentAt || !!payment.chargedFor;
      if (
        payment.status !== "succeeded" ||
        payment.refundedAt ||
        (externalId && BANKLESS_ID.test(externalId)) ||
        (!options.recorded &&
          !viaSubscription &&
          (!externalId || !tochkaAvailable()))
      ) {
        return { result: "not_refundable" as const };
      }
      if (viaSubscription && !options.recorded) {
        return { result: "bank_only" as const };
      }
      if (
        !payment.periodEnd ||
        payment.periodEnd.getTime() !== paidUntil?.getTime()
      ) {
        return { result: "not_latest" as const };
      }

      if (!options.recorded && externalId) {
        await refundTochkaPayment(externalId, payment.amount);
        bankRefunded = { externalId };
      }

      await tx
        .update(SubscriptionPayment)
        .set({ refundedAt: sql`now()` })
        .where(eq(SubscriptionPayment.id, paymentId));
      await tx.execute(sql`
        update subscriptions s
        set paid_until = (
              select max(sp.period_end) from subscription_payments sp
              where sp.user_id = s.user_id and sp.status = 'succeeded'
                and sp.refunded_at is null
            ),
            updated_at = now()
        where s.user_id = ${payment.userId}
      `);
      // A refund is a sign the specialist doesn't want to be charged.
      await tx
        .update(SubscriptionAutorenewal)
        .set({
          status: "canceled",
          canceledAt: new Date(),
          cancelReason: "refund",
        })
        .where(
          and(
            eq(SubscriptionAutorenewal.userId, payment.userId),
            eq(SubscriptionAutorenewal.status, "active"),
          ),
        );

      const settled = await tx.query.SubscriptionPayment.findFirst({
        where: eq(SubscriptionPayment.id, paymentId),
      });
      if (!settled)
        throw new Error(`Subscription payment ${paymentId} vanished`);
      return { result: "refunded" as const, payment: settled };
    });
    if (outcome.result === "refunded") {
      logger.info("billing.refunded", {
        paymentId,
        amount: outcome.payment.amount,
      });
    }
    return outcome;
  } catch (error) {
    if (bankRefunded) {
      // The money is back with the customer and the records rolled back: a
      // human has to record it.
      logger.error("billing.refund_unrecorded", error, {
        paymentId,
        externalId: bankRefunded.externalId,
      });
    }
    throw error;
  }
}

/**
 * Sandbox only: play the bank for the caller's pending payment — paid or
 * declined — and settle it exactly as a real `APPROVED` / `EXPIRED` would.
 * Returns undefined for a payment that isn't the caller's, isn't from the
 * sandbox, or when the sandbox is off.
 */
export async function settleSandboxPayment(
  db: Database,
  input: {
    userId: string;
    paymentId: string;
    outcome: Extract<PaymentStatus, "succeeded" | "canceled">;
  },
) {
  if (!tochkaSandbox()) return undefined;
  const found = await db.query.SubscriptionPayment.findFirst({
    where: and(
      eq(SubscriptionPayment.id, input.paymentId),
      eq(SubscriptionPayment.userId, input.userId),
    ),
  });
  if (!found || !isSandboxPayment(found)) return undefined;
  if (found.status !== "pending") return found;
  return settleSubscriptionPayment(db, found.id, input.outcome);
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
  // The sandbox bank knows nothing about our payments (hardcoded answers).
  if (!tochkaAvailable() || tochkaSandbox()) return payment;

  try {
    const remote = await fetchTochkaPayment(payment.externalId);
    if (remote.status === "pending") return payment;
    if (
      remote.status === "succeeded" &&
      Math.round(remote.amount * 100) !== payment.amount
    ) {
      logger.error("billing.amount_mismatch", undefined, {
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
  if (!operationId) return new Response("OK");
  const payment = await db.query.SubscriptionPayment.findFirst({
    where: eq(SubscriptionPayment.externalId, operationId),
  });
  const order = payment
    ? undefined
    : await db.query.SlugOrder.findFirst({
        where: eq(SlugOrder.externalId, operationId),
      });
  if (!payment && !order) return new Response("OK");

  const synced = payment
    ? await syncSubscriptionPayment(db, payment)
    : order && (await syncSlugOrder(db, order));
  return synced?.status === "pending"
    ? new Response("Not settled yet", { status: 503 })
    : new Response("OK");
}

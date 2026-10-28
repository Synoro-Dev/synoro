import { env, logger, paths } from "@synoro/config";
import {
  and,
  type Database,
  eq,
  Payment,
  PaymentAccount,
  type PaymentProvider,
  type PaymentStatus,
  sql,
} from "@synoro/db";

import { decryptSecret } from "./secrets";
import { tbank, tbankStatus, verifyTbankToken } from "./tbank";
import { type PaymentGateway, ProviderError } from "./types";
import { yookassa } from "./yookassa";

export { encryptSecret, secretsAvailable } from "./secrets";
export { ProviderError } from "./types";

export const gateways: Record<PaymentProvider, PaymentGateway> = {
  yookassa,
  tbank,
};

export const PROVIDER_NAMES: Record<PaymentProvider, string> = {
  yookassa: "ЮKassa",
  tbank: "Т-Банк",
};

type PaymentRow = typeof Payment.$inferSelect;
type AccountRow = typeof PaymentAccount.$inferSelect;

/** Where the provider posts status changes; ЮKassa needs it set by hand. */
export function notificationUrl(provider: PaymentProvider) {
  return new URL(`/api/payments/${provider}`, env.APP_URL).href;
}

/** Back from the payment page to the client's cabinet, which checks it. */
export function returnUrl(paymentId: string) {
  const url = new URL(paths.booking.mine, env.APP_URL);
  url.searchParams.set("payment", paymentId);
  return url.href;
}

export function credentialsOf(account: AccountRow) {
  return {
    merchantId: account.merchantId,
    secret: decryptSecret(account.secret),
  };
}

/**
 * Move a pending payment to its final status. Success marks it paid, adds
 * the credits and writes the history entry in ONE statement, so it happens
 * exactly once however many webhooks and status checks race (the Neon HTTP
 * driver has no interactive transactions). Settled payments never change.
 */
async function settlePayment(
  db: Database,
  paymentId: string,
  status: PaymentStatus,
) {
  if (status === "canceled") {
    await db
      .update(Payment)
      .set({ status: "canceled", confirmationUrl: null })
      .where(and(eq(Payment.id, paymentId), eq(Payment.status, "pending")));
  } else if (status === "succeeded") {
    await db.execute(sql`
      with paid as (
        update payments
        set status = 'succeeded', paid_at = now(), confirmation_url = null,
            updated_at = now()
        where id = ${paymentId} and status = 'pending'
        returning id, member_id, credits, created_by_id
      ), topped_up as (
        update practice_members
        set credits = practice_members.credits + paid.credits,
            updated_at = now()
        from paid
        where practice_members.id = paid.member_id
        returning practice_members.id
      )
      insert into credit_entries
        (member_id, delta, reason, payment_id, note, created_by_id)
      select member_id, credits, 'purchase', id, 'Оплата онлайн', created_by_id
      from paid
      where member_id is not null
    `);
  }

  const payment = await db.query.Payment.findFirst({
    where: eq(Payment.id, paymentId),
  });
  if (!payment) throw new Error(`Payment ${paymentId} disappeared`);
  return payment;
}

/**
 * Ask the provider about a pending payment and settle it. The provider is
 * the source of truth: webhooks only say "look again". When it can't be
 * reached the payment stays pending and is checked next time.
 */
export async function syncPayment(db: Database, payment: PaymentRow) {
  if (payment.status !== "pending" || !payment.externalId) return payment;

  const account = await db.query.PaymentAccount.findFirst({
    where: eq(PaymentAccount.id, payment.accountId),
  });
  if (!account) return payment;

  try {
    const remote = await gateways[payment.provider].fetch(
      credentialsOf(account),
      payment.externalId,
    );
    if (remote.status === "pending") return payment;
    const settled = await settlePayment(db, payment.id, remote.status);
    logger.info("payment.settled", {
      paymentId: payment.id,
      provider: payment.provider,
      status: settled.status,
    });
    return settled;
  } catch (error) {
    logger.warn("payment.sync_failed", {
      paymentId: payment.id,
      provider: payment.provider,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof ProviderError) return payment;
    throw error;
  }
}

function findByExternalId(
  db: Database,
  provider: PaymentProvider,
  externalId: string,
) {
  return db.query.Payment.findFirst({
    where: and(
      eq(Payment.provider, provider),
      eq(Payment.externalId, externalId),
    ),
  });
}

/**
 * HTTP notifications from the providers, `POST /api/payments/<provider>`.
 *
 * ЮKassa notifications aren't signed: the payment is re-read through the
 * API with the practice's own key, so a forged one changes nothing.
 * Т-Банк ones carry a `Token` signed with the terminal password, checked
 * before anything else; it also wants the body `OK` back, or it retries.
 * Unknown payments are acknowledged so the provider stops retrying.
 */
export async function handlePaymentWebhook(
  provider: string,
  request: Request,
  db: Database,
): Promise<globalThis.Response> {
  if (provider !== "yookassa" && provider !== "tbank") {
    return new Response("Unknown provider", { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== "object") {
    return new Response("Bad request", { status: 400 });
  }

  if (provider === "yookassa") {
    const object = body.object as { id?: unknown } | undefined;
    const externalId = typeof object?.id === "string" ? object.id : undefined;
    const payment =
      externalId && (await findByExternalId(db, provider, externalId));
    if (payment) await syncPayment(db, payment);
    return new Response(null, { status: 200 });
  }

  const externalId =
    typeof body.PaymentId === "string" || typeof body.PaymentId === "number"
      ? String(body.PaymentId)
      : undefined;
  const payment =
    externalId && (await findByExternalId(db, provider, externalId));
  if (!payment) return new Response("OK");

  const account = await db.query.PaymentAccount.findFirst({
    where: eq(PaymentAccount.id, payment.accountId),
  });
  if (
    !account ||
    body.TerminalKey !== account.merchantId ||
    !verifyTbankToken(body, decryptSecret(account.secret))
  ) {
    logger.warn("payment.webhook_rejected", {
      provider,
      paymentId: payment.id,
    });
    return new Response("Invalid token", { status: 403 });
  }

  const status = tbankStatus(String(body.Status ?? ""));
  if (status === "succeeded" && Number(body.Amount) !== payment.amount) {
    logger.error("payment.amount_mismatch", {
      paymentId: payment.id,
      expected: payment.amount,
      received: body.Amount,
    });
    return new Response("OK");
  }
  if (status !== "pending") await settlePayment(db, payment.id, status);
  return new Response("OK");
}

import { env, logger, paths } from "@synoro/config";
import {
  and,
  Booking,
  type Database,
  eq,
  isNotNull,
  Payment,
  PaymentAccount,
  type PaymentPackage,
  type PaymentProvider,
  type PaymentStatus,
  type Practice,
  sql,
} from "@synoro/db";
import { formatCredits, professionTerms } from "@synoro/validators";

import { guestBookingUrl } from "../urls";
import { decryptSecret, secretsAvailable } from "./secrets";
import { tbank, tbankStatus, verifyTbankToken } from "./tbank";
import { type PaymentGateway, ProviderError } from "./types";
import { yookassa } from "./yookassa";

/** Back from the payment page to the visitor booking page, which checks it. */
export const guestReturnUrl = guestBookingUrl;

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

/**
 * A demo shop of the demo stand (DEMO_LOGIN_EMAIL, seeded with a `demo-`
 * merchant id): it has no real keys and no provider behind it, so a payment
 * is "paid" the moment it is started. Never true on a real deployment.
 */
function isDemoAccount(account: Pick<AccountRow, "test" | "merchantId">) {
  return (
    !!env.DEMO_LOGIN_EMAIL &&
    account.test &&
    account.merchantId.startsWith("demo-")
  );
}

/** Payments work: the secrets can be decrypted, or it is a demo shop. */
export function canTakePayments(
  account: Pick<AccountRow, "test" | "merchantId">,
) {
  return isDemoAccount(account) || secretsAvailable();
}

export function credentialsOf(account: AccountRow) {
  return {
    merchantId: account.merchantId,
    secret: decryptSecret(account.secret),
  };
}

/**
 * Create a pending payment for `pkg` and open it with the practice's
 * provider. Returns the payment and the provider's page to send the client
 * to. Throws `ProviderError` when the provider refuses; in every failure the
 * row is dropped, since nothing was charged.
 */
export async function startPayment(
  db: Database,
  input: {
    practice: typeof Practice.$inferSelect;
    account: AccountRow;
    pkg: typeof PaymentPackage.$inferSelect;
    memberId: string;
    user: { id: string; email: string };
    /** The booking being paid for (a visitor's), confirmed on success. */
    bookingId?: string;
    returnUrl: (paymentId: string) => string;
  },
) {
  const { practice, account, pkg } = input;
  const [payment] = await db
    .insert(Payment)
    .values({
      practiceId: practice.id,
      accountId: account.id,
      memberId: input.memberId,
      bookingId: input.bookingId,
      provider: account.provider,
      credits: pkg.credits,
      amount: pkg.price,
      createdById: input.user.id,
    })
    .returning();
  if (!payment) throw new Error("Failed to insert payment");

  if (isDemoAccount(account)) {
    await db
      .update(Payment)
      .set({ externalId: `demo-${payment.id}` })
      .where(eq(Payment.id, payment.id));
    await settlePayment(db, payment.id, "succeeded");
    // No provider page: straight back to where the client came from.
    return {
      paymentId: payment.id,
      confirmationUrl: input.returnUrl(payment.id),
    };
  }

  const terms = professionTerms(practice.profession);
  const item = `${formatCredits(pkg.credits, terms)} — ${practice.name}`;
  try {
    const remote = await gateways[account.provider].create(
      credentialsOf(account),
      {
        orderId: payment.id,
        amount: pkg.price,
        description: `Оплата: ${item}`,
        returnUrl: input.returnUrl(payment.id),
        notificationUrl: notificationUrl(account.provider),
        email: input.user.email,
        receipt: account.receipts
          ? { itemName: `Пакет: ${item}`, taxSystem: account.taxSystem }
          : undefined,
      },
    );
    if (!remote.confirmationUrl) {
      throw new ProviderError("unavailable", "No payment page returned");
    }
    await db
      .update(Payment)
      .set({
        externalId: remote.externalId,
        confirmationUrl: remote.confirmationUrl,
      })
      .where(eq(Payment.id, payment.id));
    return { paymentId: payment.id, confirmationUrl: remote.confirmationUrl };
  } catch (error) {
    await db.delete(Payment).where(eq(Payment.id, payment.id));
    throw error;
  }
}

/** What to tell the client when the provider refused a payment. */
export function providerFailureMessage(error: ProviderError) {
  return error.kind === "credentials"
    ? "Оплата у специалиста временно не работает — сообщите ему, пожалуйста"
    : error.kind === "rejected"
      ? error.message
      : undefined;
}

/**
 * Move a pending payment to its final status.
 *
 * Success marks it paid, adds the credits and writes the history entry in ONE
 * statement, so it happens exactly once however many webhooks and status
 * checks race (the Neon HTTP driver has no interactive transactions). A payment
 * made for a booking also confirms that booking and spends one of its credits
 * on it — unless the hold ran out and the booking was released meanwhile: then
 * the credits just land on the balance and the client picks another time.
 * Cancellation of such a payment releases the held time. Settled payments
 * never change.
 */
async function settlePayment(
  db: Database,
  paymentId: string,
  status: PaymentStatus,
) {
  if (status === "canceled") {
    const [canceled] = await db
      .update(Payment)
      .set({ status: "canceled", confirmationUrl: null })
      .where(and(eq(Payment.id, paymentId), eq(Payment.status, "pending")))
      .returning({ bookingId: Payment.bookingId });
    if (canceled?.bookingId) {
      await db
        .update(Booking)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(
          and(
            eq(Booking.id, canceled.bookingId),
            eq(Booking.status, "active"),
            isNotNull(Booking.holdUntil),
          ),
        );
    }
  } else if (status === "succeeded") {
    await db.execute(sql`
      with paid as (
        update payments
        set status = 'succeeded', paid_at = now(), confirmation_url = null,
            updated_at = now()
        where id = ${paymentId} and status = 'pending'
        returning id, member_id, booking_id, credits, created_by_id
      ), confirmed as (
        update bookings
        set hold_until = null, updated_at = now()
        from paid
        where bookings.id = paid.booking_id
          and bookings.status = 'active'
          and bookings.hold_until is not null
        returning bookings.id, bookings.member_id
      ), topped_up as (
        update practice_members
        set credits = practice_members.credits + paid.credits
              - (select count(*) from confirmed)::int,
            updated_at = now()
        from paid
        where practice_members.id = paid.member_id
        returning practice_members.id
      ), purchase as (
        insert into credit_entries
          (member_id, delta, reason, payment_id, note, created_by_id)
        select member_id, credits, 'purchase', id, 'Оплата онлайн', created_by_id
        from paid
        where member_id is not null
        returning id
      )
      insert into credit_entries
        (member_id, delta, reason, booking_id, note, created_by_id)
      select confirmed.member_id, -1, 'booking', confirmed.id, 'Оплата онлайн',
        paid.created_by_id
      from confirmed, paid
      where confirmed.member_id is not null
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

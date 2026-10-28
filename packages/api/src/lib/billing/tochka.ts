import { env } from "@synoro/config";
import type { PaymentStatus } from "@synoro/db";

import { ProviderError } from "../payments/types";

/**
 * Synoro's own Точка Банк internet acquiring: payment links (card, СБП)
 * for «Про». Unlike `lib/payments`, the merchant is the platform, so the
 * credentials come from env, not from a practice.
 * @see https://developers.tochka.com/docs/tochka-api/opisanie-metodov/platyozhnye-ssylki
 */

/** Payment link lifetime, minutes: a pending payment expires after a day. */
const LINK_TTL_MINUTES = 24 * 60;

export function tochkaAvailable() {
  return !!env.TOCHKA_API_TOKEN && !!env.TOCHKA_CUSTOMER_CODE;
}

/**
 * APPROVED — paid. EXPIRED — the link ran out unpaid. CREATED (and the
 * two-stage AUTHORIZED, which we don't use) — not yet. Refund statuses
 * only follow APPROVED, and a settled payment never changes.
 */
function tochkaStatus(status: string): PaymentStatus {
  if (status === "APPROVED") return "succeeded";
  if (status === "EXPIRED") return "canceled";
  return "pending";
}

interface TochkaOperation {
  operationId: string;
  status: string;
  amount: number;
  paymentLink: string;
}

export interface TochkaPayment {
  externalId: string;
  status: PaymentStatus;
  /** Rubles, as the bank reports it. */
  amount: number;
  confirmationUrl: string;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.TOCHKA_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.TOCHKA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ProviderError("unavailable", "Точка Банк не отвечает", {
      cause: error,
    });
  }
  if (response.status >= 500) {
    throw new ProviderError("unavailable", "Точка Банк временно недоступен");
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { message?: string; Errors?: { message?: string }[] })
    | null;
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError("credentials", "Точка Банк не принял JWT-ключ");
  }
  if (!response.ok || !data) {
    throw new ProviderError(
      "rejected",
      data?.Errors?.[0]?.message ??
        data?.message ??
        `Точка Банк: ошибка ${response.status}`,
    );
  }
  return data;
}

function toPayment(operation: TochkaOperation): TochkaPayment {
  return {
    externalId: operation.operationId,
    status: tochkaStatus(operation.status),
    amount: Number(operation.amount),
    confirmationUrl: operation.paymentLink,
  };
}

const rubles = (kopecks: number) => Math.round(kopecks) / 100;

/**
 * Open a payment link. With TOCHKA_TAX_SYSTEM set it goes through
 * `payments_with_receipt`, and Точка's cash register mails the 54-ФЗ
 * receipt to `email`.
 */
export async function createTochkaPayment(request: {
  /** Our payment id, Точка's `paymentLinkId` (unique per link). */
  orderId: string;
  /** Kopecks. */
  amount: number;
  purpose: string;
  itemName: string;
  email: string;
  returnUrl: string;
}): Promise<TochkaPayment> {
  const amount = rubles(request.amount);
  const base = {
    customerCode: env.TOCHKA_CUSTOMER_CODE,
    ...(env.TOCHKA_MERCHANT_ID && { merchantId: env.TOCHKA_MERCHANT_ID }),
    amount,
    purpose: request.purpose.slice(0, 210),
    redirectUrl: request.returnUrl,
    failRedirectUrl: request.returnUrl,
    paymentMode: ["card", "sbp"],
    ttl: LINK_TTL_MINUTES,
    paymentLinkId: request.orderId,
  };
  const { Data } = env.TOCHKA_TAX_SYSTEM
    ? await call<{ Data: TochkaOperation }>(
        "POST",
        "/acquiring/v1.0/payments_with_receipt",
        {
          Data: {
            ...base,
            taxSystemCode: env.TOCHKA_TAX_SYSTEM,
            Client: { email: request.email },
            Items: [
              {
                name: request.itemName.slice(0, 128),
                amount,
                quantity: 1,
                vatType: "none",
                paymentMethod: "full_prepayment",
                paymentObject: "service",
                measure: "шт.",
              },
            ],
          },
        },
      )
    : await call<{ Data: TochkaOperation }>(
        "POST",
        "/acquiring/v1.0/payments",
        { Data: base },
      );
  return toPayment(Data);
}

export async function fetchTochkaPayment(
  operationId: string,
): Promise<TochkaPayment> {
  const { Data } = await call<{ Data: { Operation: TochkaOperation[] } }>(
    "GET",
    `/acquiring/v1.0/payments/${encodeURIComponent(operationId)}`,
  );
  const operation = Data.Operation[0];
  if (!operation) {
    throw new ProviderError("rejected", `Операция ${operationId} не найдена`);
  }
  return toPayment(operation);
}

/**
 * The `operationId` of an `acquiringInternetPayment` webhook. The body is a
 * JWT (RS256, Точка's key); its claims are read WITHOUT checking the
 * signature, because nothing is trusted from them: the operation is then
 * re-read through the API with our own key, as with ЮKassa.
 */
export function tochkaWebhookOperationId(body: string): string | undefined {
  const payload = body.trim().split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { webhookType?: unknown; operationId?: unknown };
    return claims.webhookType === "acquiringInternetPayment" &&
      typeof claims.operationId === "string"
      ? claims.operationId
      : undefined;
  } catch {
    return undefined;
  }
}

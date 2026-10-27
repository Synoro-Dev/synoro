import type { PaymentStatus, TaxSystem } from "@synoro/db";

import {
  type MerchantCredentials,
  type PaymentGateway,
  ProviderError,
  type ProviderPayment,
} from "./types";

const API = "https://api.yookassa.ru/v3";

/** `tax_system_code` in receipts. */
const TAX_SYSTEM_CODES: Record<TaxSystem, number> = {
  osn: 1,
  usn_income: 2,
  usn_income_outcome: 3,
  esn: 5,
  patent: 6,
};

interface YooKassaPayment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  confirmation?: { type: string; confirmation_url?: string };
}

const rubles = (kopecks: number) => (kopecks / 100).toFixed(2);

function toProviderPayment(payment: YooKassaPayment): ProviderPayment {
  // `capture: true` makes payments one-stage, so waiting_for_capture only
  // shows up briefly; it isn't money on the balance yet.
  const status: PaymentStatus =
    payment.status === "succeeded"
      ? "succeeded"
      : payment.status === "canceled"
        ? "canceled"
        : "pending";
  return {
    externalId: payment.id,
    status,
    confirmationUrl: payment.confirmation?.confirmation_url,
  };
}

async function request<T>(
  credentials: MerchantCredentials,
  path: string,
  init: { body?: unknown; idempotenceKey?: string } = {},
): Promise<T> {
  const auth = Buffer.from(
    `${credentials.merchantId}:${credentials.secret}`,
  ).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ...(init.idempotenceKey && { "Idempotence-Key": init.idempotenceKey }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ProviderError("unavailable", "ЮKassa не отвечает", {
      cause: error,
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderError(
      "credentials",
      "ЮKassa не приняла shopId или секретный ключ",
    );
  }
  if (response.status >= 500) {
    throw new ProviderError("unavailable", "ЮKassa временно недоступна");
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    description?: string;
  };
  if (!response.ok) {
    throw new ProviderError(
      "rejected",
      data.description ?? `ЮKassa: ошибка ${response.status}`,
    );
  }
  return data;
}

/**
 * ЮKassa API v3: Basic auth with shopId:secretKey, one-stage payments with
 * a redirect to the ЮKassa payment page.
 * @see https://yookassa.ru/developers/api
 */
export const yookassa: PaymentGateway = {
  async verify(credentials) {
    const me = await request<{ test?: boolean }>(credentials, "/me");
    return { test: me.test === true };
  },

  async create(credentials, payment) {
    const amount = { value: rubles(payment.amount), currency: "RUB" };
    const created = await request<YooKassaPayment>(credentials, "/payments", {
      idempotenceKey: payment.orderId,
      body: {
        amount,
        capture: true,
        confirmation: { type: "redirect", return_url: payment.returnUrl },
        description: payment.description.slice(0, 128),
        metadata: { paymentId: payment.orderId },
        ...(payment.receipt && {
          receipt: {
            customer: { email: payment.email },
            items: [
              {
                description: payment.receipt.itemName.slice(0, 128),
                quantity: 1,
                amount,
                // Psychological consultations are VAT-exempt by default.
                vat_code: 1,
                payment_mode: "full_prepayment",
                payment_subject: "service",
              },
            ],
            ...(payment.receipt.taxSystem && {
              tax_system_code: TAX_SYSTEM_CODES[payment.receipt.taxSystem],
            }),
          },
        }),
      },
    });
    return toProviderPayment(created);
  },

  async fetch(credentials, externalId) {
    const payment = await request<YooKassaPayment>(
      credentials,
      `/payments/${encodeURIComponent(externalId)}`,
    );
    return toProviderPayment(payment);
  },
};

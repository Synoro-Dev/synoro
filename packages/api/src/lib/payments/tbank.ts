import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentStatus } from "@synoro/db";

import {
  type MerchantCredentials,
  type PaymentGateway,
  ProviderError,
  type ProviderPayment,
} from "./types";

const API = "https://securepay.tinkoff.ru/v2";

const PAID = new Set(["CONFIRMED"]);
const FAILED = new Set([
  "CANCELED",
  "REJECTED",
  "DEADLINE_EXPIRED",
  "AUTH_FAIL",
  "REVERSED",
]);
/** Wrong TerminalKey / password, or a blocked terminal. */
const CREDENTIAL_ERRORS = new Set(["202", "204", "501"]);

/**
 * Request / notification signature: root-level scalar fields (nested
 * objects such as `Receipt` and `DATA` excluded) plus `Password`, sorted by
 * key, values concatenated, SHA-256 hex.
 * @see https://developer.tbank.ru/eacq/intro/developer/token
 */
export function tbankToken(params: Record<string, unknown>, password: string) {
  const fields = Object.entries({ ...params, Password: password }).filter(
    ([key, value]) =>
      key !== "Token" && ["string", "number", "boolean"].includes(typeof value),
  );
  fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256")
    .update(fields.map(([, value]) => String(value)).join(""), "utf8")
    .digest("hex");
}

/** Constant-time check of a notification's `Token`. */
export function verifyTbankToken(
  body: Record<string, unknown>,
  password: string,
) {
  if (typeof body.Token !== "string") return false;
  const expected = Buffer.from(tbankToken(body, password));
  const actual = Buffer.from(body.Token.toLowerCase());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function tbankStatus(status: string): PaymentStatus {
  if (PAID.has(status)) return "succeeded";
  if (FAILED.has(status)) return "canceled";
  // NEW, FORM_SHOWED, AUTHORIZING, 3DS_*, AUTHORIZED, CONFIRMING…
  return "pending";
}

interface TbankResponse {
  Success: boolean;
  ErrorCode: string;
  Message?: string;
  Details?: string;
  Status?: string;
  PaymentId?: string | number;
  PaymentURL?: string;
}

async function call(
  credentials: MerchantCredentials,
  method: string,
  params: Record<string, unknown>,
): Promise<TbankResponse> {
  const body = { TerminalKey: credentials.merchantId, ...params };
  let response: Response;
  try {
    response = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        Token: tbankToken(body, credentials.secret),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ProviderError("unavailable", "Т-Банк не отвечает", {
      cause: error,
    });
  }
  if (response.status >= 500) {
    throw new ProviderError("unavailable", "Т-Банк временно недоступен");
  }
  const data = (await response.json().catch(() => null)) as TbankResponse;
  if (!data) {
    throw new ProviderError("unavailable", "Т-Банк вернул пустой ответ");
  }
  return data;
}

function fail(data: TbankResponse): never {
  if (CREDENTIAL_ERRORS.has(data.ErrorCode)) {
    throw new ProviderError(
      "credentials",
      "Т-Банк не принял TerminalKey или пароль терминала",
    );
  }
  throw new ProviderError(
    "rejected",
    [data.Message, data.Details].filter(Boolean).join(": ") ||
      `Т-Банк: ошибка ${data.ErrorCode}`,
  );
}

function toProviderPayment(data: TbankResponse): ProviderPayment {
  if (!data.Success || data.PaymentId === undefined) fail(data);
  return {
    externalId: String(data.PaymentId),
    status: tbankStatus(data.Status ?? "NEW"),
    confirmationUrl: data.PaymentURL,
  };
}

/**
 * Т-Банк интернет-эквайринг API v2. The terminal must be one-stage
 * (payments end in CONFIRMED): two-stage ones stop at AUTHORIZED and
 * would need a manual Confirm.
 * @see https://developer.tbank.ru/eacq/api/init
 */
export const tbank: PaymentGateway = {
  async verify(credentials) {
    // No "who am I" method: ask for a payment that can't exist. A bad
    // token or terminal fails with its own error code; anything else
    // means the key pair is right.
    const data = await call(credentials, "GetState", { PaymentId: "1" });
    if (CREDENTIAL_ERRORS.has(data.ErrorCode)) fail(data);
    return { test: credentials.merchantId.toUpperCase().endsWith("DEMO") };
  },

  async create(credentials, payment) {
    const data = await call(credentials, "Init", {
      Amount: payment.amount,
      OrderId: payment.orderId,
      Description: payment.description.slice(0, 140),
      SuccessURL: payment.returnUrl,
      FailURL: payment.returnUrl,
      NotificationURL: payment.notificationUrl,
      DATA: { Email: payment.email },
      ...(payment.receipt && {
        Receipt: {
          Email: payment.email,
          Taxation: payment.receipt.taxSystem ?? "usn_income",
          Items: [
            {
              Name: payment.receipt.itemName.slice(0, 128),
              Price: payment.amount,
              Quantity: 1,
              Amount: payment.amount,
              Tax: "none",
              PaymentMethod: "full_prepayment",
              PaymentObject: "service",
            },
          ],
        },
      }),
    });
    return toProviderPayment(data);
  },

  async fetch(credentials, externalId) {
    const data = await call(credentials, "GetState", {
      PaymentId: externalId,
    });
    return toProviderPayment(data);
  },
};

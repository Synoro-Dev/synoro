import type { PaymentStatus, TaxSystem } from "@synoro/db";

export interface MerchantCredentials {
  /** ЮKassa shopId / Т-Банк TerminalKey. */
  merchantId: string;
  /** ЮKassa secret key / Т-Банк terminal password (decrypted). */
  secret: string;
}

interface CreatePaymentRequest {
  /** Our payment id: the idempotence key and the provider's order id. */
  orderId: string;
  /** Kopecks. */
  amount: number;
  description: string;
  returnUrl: string;
  notificationUrl: string;
  /** Receipt recipient, also prefilled on the payment form. */
  email: string;
  /** Set when the account sends 54-ФЗ receipts. */
  receipt?: { itemName: string; taxSystem: TaxSystem | null };
}

export interface ProviderPayment {
  externalId: string;
  status: PaymentStatus;
  confirmationUrl?: string;
}

/**
 * credentials — the provider rejected the shop id / key.
 * rejected    — the provider refused this request (message from them).
 * unavailable — network error or a 5xx: try again later.
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: "credentials" | "rejected" | "unavailable",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export interface PaymentGateway {
  /** Checks the credentials; `test` for a demo shop / test terminal. */
  verify(credentials: MerchantCredentials): Promise<{ test: boolean }>;
  create(
    credentials: MerchantCredentials,
    request: CreatePaymentRequest,
  ): Promise<ProviderPayment>;
  fetch(
    credentials: MerchantCredentials,
    externalId: string,
  ): Promise<ProviderPayment>;
}

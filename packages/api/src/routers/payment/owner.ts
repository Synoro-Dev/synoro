import { type Database, eq, PaymentAccount } from "@synoro/db";

import {
  canTakePayments,
  notificationUrl,
  PROVIDER_NAMES,
  secretsAvailable,
} from "../../lib/payments";
import { practiceProcedure } from "../../lib/practice-access";

/** The merchant account takes the owner's money: administrators can't touch it. */
export const ownerProcedure = practiceProcedure.errors({
  FORBIDDEN: { message: "Оплату настраивает только владелец практики" },
});

/**
 * The practice's payment setup as the owner sees it. Secrets never leave
 * the server; `savedProviders` tells which ones can be re-enabled without
 * typing the key again.
 */
export async function paymentSettings(db: Database, practiceId: string) {
  const accounts = await db.query.PaymentAccount.findMany({
    where: eq(PaymentAccount.practiceId, practiceId),
  });
  const active = accounts.find((a) => a.active);

  return {
    available: active ? canTakePayments(active) : secretsAvailable(),
    account: active
      ? {
          provider: active.provider,
          providerName: PROVIDER_NAMES[active.provider],
          merchantId: active.merchantId,
          test: active.test,
          receipts: active.receipts,
          taxSystem: active.taxSystem,
          connectedAt: active.updatedAt ?? active.createdAt,
        }
      : null,
    savedProviders: accounts.map((a) => a.provider),
    notificationUrls: {
      yookassa: notificationUrl("yookassa"),
      tbank: notificationUrl("tbank"),
    },
  };
}

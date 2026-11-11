import { handleBillingWebhook } from "@synoro/api";
import { db } from "@synoro/db";

/**
 * Точка Банк `acquiringInternetPayment` webhooks for «Про» payments
 * (registered once for the platform, see docs/billing.md). See
 * `handleBillingWebhook` for how they are trusted.
 */
export async function POST(request: Request) {
  return handleBillingWebhook(request, db);
}

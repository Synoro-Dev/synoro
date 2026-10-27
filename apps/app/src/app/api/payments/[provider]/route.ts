import { handlePaymentWebhook } from "@synoro/api";
import { db } from "@synoro/db";

/**
 * HTTP notifications from ЮKassa (`/api/payments/yookassa`, set by the
 * specialist in the ЮKassa dashboard) and Т-Банк (`/api/payments/tbank`,
 * sent with each payment). See `handlePaymentWebhook` for how each is
 * trusted.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/payments/[provider]">,
) {
  const { provider } = await params;
  return handlePaymentWebhook(provider, request, db);
}

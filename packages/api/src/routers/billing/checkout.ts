import { logger } from "@synoro/config";
import { billingCheckoutSchema } from "@synoro/validators";

import { billingAvailable, startSubscriptionPayment } from "../../lib/billing";
import { adAttribution } from "../../lib/billing/attribution";
import { ProviderError } from "../../lib/payments";
import { protectedProcedure } from "../../orpc";

/**
 * Start paying for a month or a year of «Про». With `autorenew` (the consent
 * to automatic charges) the payment also binds the card for renewals. Returns
 * the Точка payment page to redirect to; afterwards the specialist lands on the billing page,
 * which checks the payment (`billing.status`) — the webhook settles it too.
 *
 * @example const { confirmationUrl } = await client.billing.checkout({ period: "year", autorenew: true })
 */
export const checkout = protectedProcedure
  .errors({
    BILLING_UNAVAILABLE: {
      message: "Оплата тарифа временно недоступна, попробуйте позже",
    },
    PROVIDER_ERROR: {
      message: "Банк не принял платёж, попробуйте позже",
    },
  })
  .input(billingCheckoutSchema)
  .handler(async ({ context, input, errors }) => {
    if (!billingAvailable()) throw errors.BILLING_UNAVAILABLE();
    const { user } = context.session;
    try {
      return await startSubscriptionPayment(context.db, {
        user,
        period: input.period,
        autorenew: input.autorenew,
        attribution: adAttribution(context.headers),
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      logger.error("billing.create_failed", error, {
        userId: user.id,
        kind: error.kind,
      });
      throw errors.PROVIDER_ERROR({ cause: error });
    }
  });

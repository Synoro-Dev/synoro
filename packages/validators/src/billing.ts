import { z } from "zod";

export const BILLING_PERIODS = ["month", "year"] as const;

export type BillingPeriodId = (typeof BILLING_PERIODS)[number];

/** Days of «Про» a new specialist gets before the first payment. */
export const TRIAL_DAYS = 14;

/**
 * «Про» prices in kopecks. A year costs ten months. Keep in sync with
 * `apps/web/src/lib/pricing.ts` (the landing doesn't depend on this package).
 */
export const PRO_PRICES: Record<
  BillingPeriodId,
  { amount: number; label: string; months: number }
> = {
  month: { amount: 149_00, label: "Месяц", months: 1 },
  year: { amount: 1490_00, label: "Год", months: 12 },
};

export const billingCheckoutSchema = z.object({
  period: z.enum(BILLING_PERIODS),
});

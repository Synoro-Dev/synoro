import { z } from "zod";

/**
 * How a client paid the specialist outside Synoro. Keep in sync with
 * `offlinePaymentMethod` in `@synoro/db`.
 */
export const OFFLINE_PAYMENT_METHODS = [
  "cash",
  "transfer",
  "card",
  "other",
] as const;

export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

export const OFFLINE_PAYMENT_METHOD_LABELS: Record<
  OfflinePaymentMethod,
  string
> = {
  cash: "Наличные",
  transfer: "Перевод",
  card: "Карта",
  other: "Другое",
};

/** The most one payment may be, kopecks: 1 000 000 ₽. */
export const OFFLINE_PAYMENT_MAX = 100_000_000;

/** «2 500», «2500,50», «2 500 ₽» → kopecks; NaN when it isn't a sum. */
export function parseRubles(input: string) {
  const clean = input.replace(/[\s ₽]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
}

/** A sum in kopecks, as the API takes it. */
export const offlineAmountSchema = z
  .number({ message: "Укажите сумму" })
  .int("Сумма — в рублях и копейках")
  .min(1, "Сумма должна быть больше нуля")
  .max(OFFLINE_PAYMENT_MAX, "Не больше 1 000 000 ₽ за раз");

/**
 * A payment received outside Synoro (`offlinePayment.record`): how much, how,
 * when — a day, not in the future — and a note.
 */
export const offlinePaymentFormSchema = z.object({
  amount: offlineAmountSchema,
  method: z.enum(OFFLINE_PAYMENT_METHODS),
  paidAt: z.coerce
    .date()
    .refine(
      (at) => at.getTime() <= Date.now() + 24 * 60 * 60 * 1000,
      "Дата оплаты не может быть в будущем",
    ),
  note: z.string().trim().max(500).optional(),
});

export type OfflinePaymentFormValues = z.infer<typeof offlinePaymentFormSchema>;

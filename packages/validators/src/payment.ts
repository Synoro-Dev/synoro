import { z } from "zod";

export const PAYMENT_PROVIDERS = ["yookassa", "tbank"] as const;

export const TAX_SYSTEMS = [
  "osn",
  "usn_income",
  "usn_income_outcome",
  "esn",
  "patent",
] as const;

/**
 * Connecting ЮKassa (shopId + secret key) or Т-Банк (TerminalKey +
 * password). `secret` may be left empty to keep the saved one when editing
 * the same provider. Т-Банк receipts need the taxation system.
 */
export const paymentAccountFormSchema = z
  .object({
    provider: z.enum(PAYMENT_PROVIDERS),
    merchantId: z
      .string()
      .trim()
      .min(1, "Обязательное поле")
      .max(64, "Не длиннее 64 символов")
      .regex(/^[\w.-]+$/, "Только латинские буквы, цифры, «-», «_» и «.»"),
    secret: z.string().trim().max(256, "Слишком длинный ключ").optional(),
    receipts: z.boolean(),
    taxSystem: z.enum(TAX_SYSTEMS).nullable(),
  })
  .refine((v) => !(v.receipts && v.provider === "tbank" && !v.taxSystem), {
    message: "Выберите систему налогообложения для чеков",
    path: ["taxSystem"],
  });

export type PaymentAccountFormValues = z.infer<typeof paymentAccountFormSchema>;

export const paymentPackageSchema = z.object({
  credits: z
    .number({ message: "Введите число" })
    .int("Только целое число")
    .min(1, "Не меньше 1")
    .max(100, "Не больше 100"),
  /** Kopecks. */
  price: z
    .number({ message: "Введите цену" })
    .int()
    .min(100, "Не меньше 1 ₽")
    .max(100_000_000, "Не больше 1 000 000 ₽"),
});

export const paymentPackagesFormSchema = z.object({
  packages: z
    .array(paymentPackageSchema)
    .max(10, "Не больше 10 пакетов")
    .refine(
      (packages) =>
        new Set(packages.map((p) => p.credits)).size === packages.length,
      "Два пакета одного размера",
    ),
});

export type PaymentPackagesFormValues = z.infer<
  typeof paymentPackagesFormSchema
>;

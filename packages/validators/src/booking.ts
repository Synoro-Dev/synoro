import { z } from "zod";

import { phoneSchema } from "./phone";
import { PROFESSIONS } from "./profession";

/** Free slots sit on a 30-minute grid, so schedules do too. */
const halfHourMinute = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max)
    .refine((m) => m % 30 === 0, "Время должно быть кратно 30 минутам");

/**
 * Slugs double as platform subdomains (`<slug>.<root>`), so names the
 * platform itself may need as hosts are off limits.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "blog",
  "cdn",
  "dashboard",
  "docs",
  "domains",
  "help",
  "mail",
  "smtp",
  "static",
  "status",
  "support",
  "www",
]);

export const practiceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Название должно содержать не менее 2 символов")
    .max(120, "Название не должно быть длиннее 120 символов"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Адрес должен содержать не менее 3 символов")
    .max(48, "Адрес не должен быть длиннее 48 символов")
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Только латинские буквы, цифры и дефис (не в начале и не в конце)",
    )
    .refine((slug) => !RESERVED_SLUGS.has(slug), "Этот адрес зарезервирован"),
  profession: z.enum(PROFESSIONS, "Выберите, чем вы занимаетесь"),
});

export type PracticeFormValues = z.infer<typeof practiceFormSchema>;

export const availabilityRuleSchema = z
  .object({
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: z.number().int().min(1).max(7),
    startMinute: halfHourMinute(1410),
    endMinute: halfHourMinute(1440),
  })
  .refine((r) => r.startMinute < r.endMinute, {
    message: "Конец интервала должен быть позже начала",
    path: ["endMinute"],
  });

export type AvailabilityRuleValues = z.infer<typeof availabilityRuleSchema>;

export const availabilityFormSchema = z.object({
  rules: z
    .array(availabilityRuleSchema)
    .max(168, "Не больше 168 интервалов")
    .refine(
      (rules) =>
        rules.every((a, i) =>
          rules.every(
            (b, j) =>
              i === j ||
              a.weekday !== b.weekday ||
              a.endMinute <= b.startMinute ||
              b.endMinute <= a.startMinute,
          ),
        ),
      "Интервалы одного дня не должны пересекаться",
    ),
});

export type AvailabilityFormValues = z.infer<typeof availabilityFormSchema>;

export const creditGrantFormSchema = z.object({
  delta: z
    .number({ message: "Введите число" })
    .int("Только целое число")
    .min(-100, "Не меньше −100")
    .max(100, "Не больше 100")
    .refine((n) => n !== 0, "Количество не может быть нулём"),
  note: z.string().trim().max(500).optional(),
});

export type CreditGrantFormValues = z.infer<typeof creditGrantFormSchema>;

export const freeBookingFormSchema = z.object({
  guestName: z
    .string()
    .trim()
    .min(1, "Укажите имя")
    .max(120, "Имя не должно быть длиннее 120 символов"),
  guestPhone: phoneSchema,
  /** Telegram, email — anything besides the phone. */
  guestContact: z
    .string()
    .trim()
    .max(120, "Контакт не должен быть длиннее 120 символов")
    .optional(),
  note: z.string().trim().max(500).optional(),
});

export type FreeBookingFormInput = z.input<typeof freeBookingFormSchema>;
export type FreeBookingFormValues = z.infer<typeof freeBookingFormSchema>;

/**
 * Who a visitor is when booking without an account: the phone is how the
 * specialist reaches them, the email is where their cabinet link and sign-in
 * codes go.
 */
export const guestBookingFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Укажите имя")
    .max(120, "Имя не должно быть длиннее 120 символов"),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .min(1, "Укажите адрес электронной почты")
    .email("Некорректный адрес электронной почты"),
  note: z.string().trim().max(500).optional(),
});

export type GuestBookingFormInput = z.input<typeof guestBookingFormSchema>;
export type GuestBookingFormValues = z.infer<typeof guestBookingFormSchema>;

export const memberInviteFormSchema = z.object({
  email: z.email("Некорректный адрес электронной почты"),
  role: z.enum(["admin", "client"]),
});

export type MemberInviteFormValues = z.infer<typeof memberInviteFormSchema>;

const HOSTNAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * The bare host from whatever was pasted (`https://Анна.рф/`, `anna.ru:443`):
 * lowercase ASCII, IDN as punycode — the form the `Host` header arrives in.
 * Null when it isn't a host name at all.
 */
export function normalizeHostname(input: string): string | null {
  const bare = input
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#]/)[0]
    ?.replace(/:\d*$/, "")
    .replace(/\.$/, "");
  if (!bare) return null;
  try {
    const { hostname } = new URL(`http://${bare}`);
    return HOSTNAME.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

export const customDomainFormSchema = z.object({
  hostname: z
    .string()
    .max(300)
    .transform((value, ctx) => {
      const hostname = normalizeHostname(value);
      if (!hostname) {
        ctx.addIssue({
          code: "custom",
          message:
            "Введите домен, например anna-ivanova.ru или zapis.anna-ivanova.ru",
        });
        return z.NEVER;
      }
      return hostname;
    }),
});

export type CustomDomainFormValues = z.input<typeof customDomainFormSchema>;

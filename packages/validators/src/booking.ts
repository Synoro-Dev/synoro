import { z } from "zod";

import { phoneSchema } from "./phone";
import { PROFESSIONS, pluralize } from "./profession";

/** Free slots sit on a 30-minute grid, so schedules do too. */
const halfHourMinute = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max)
    .refine((m) => m % 30 === 0, "Время должно быть кратно 30 минутам");

/**
 * Lengths an owner may give the free intro (`practices.intro_minutes`); it
 * starts on the half-hour grid whatever its length.
 */
export const INTRO_MINUTES = [30, 45, 60, 90] as const;

export const introMinutesSchema = z
  .number()
  .int()
  .refine(
    (m) => (INTRO_MINUTES as readonly number[]).includes(m),
    "Выберите длительность из списка",
  );

/**
 * A length in minutes for people: «30 минут», «1 час», «1,5 часа»;
 * `short` — «30 мин», «1 ч», «1,5 ч».
 */
export function formatMinutes(minutes: number, short = false) {
  if (minutes < 60 || minutes % 30 !== 0) {
    if (short) return `${minutes} мин`;
    return `${minutes} ${pluralize(minutes, ["минута", "минуты", "минут"])}`;
  }
  const hours = minutes / 60;
  const number = String(hours).replace(".", ",");
  if (short) return `${number} ч`;
  // A fraction takes the genitive singular: «1,5 часа».
  if (!Number.isInteger(hours)) return `${number} часа`;
  return `${number} ${pluralize(hours, ["час", "часа", "часов"])}`;
}

/** A client may cancel (and get the credit back) up to 24 h before start. */
export const CLIENT_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a client may still cancel their booking themselves at `now` (ms):
 * a paid one up to 24 h before the start, a free intro — nothing to give
 * back — until it starts. `booking.cancel` and the worker, which offers the
 * cancel button in messengers, share it.
 */
export function clientMayCancel(
  booking: { kind: string; startsAt: Date },
  now: number,
) {
  const left = booking.startsAt.getTime() - now;
  return booking.kind === "free" ? left > 0 : left >= CLIENT_CANCEL_WINDOW_MS;
}

/**
 * Slugs are the address of a booking page (`synoro.ru/<slug>`) and double as
 * platform subdomains (`<slug>.<root>`). So every top-level route of the app
 * and of the landing, and every name the platform may need as a host, is off
 * limits. A new top-level route goes here first, or a specialist can take its
 * address (`apps/app/src/lib/app-roots.test.ts` checks the existing ones).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "b",
  "billing",
  "blog",
  "bookings",
  "cdn",
  "contact",
  "contacts",
  "dashboard",
  "demo",
  "docs",
  "domains",
  "faq",
  "features",
  "help",
  "ingest",
  "legal",
  "login",
  "logout",
  "mail",
  "p",
  "practices",
  "pricing",
  "privacy",
  "pro",
  "robots",
  "security",
  "settings",
  "signup",
  "site",
  "sitemap",
  "smtp",
  "solutions",
  "static",
  "status",
  "support",
  "tariffs",
  "terms",
  "www",
]);

/** Letters, digits and hyphens; no hyphen at either end. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 48;

/** Whether `value` can be the address of a booking page. */
export function isPracticeSlug(value: string) {
  return (
    value.length >= SLUG_MIN_LENGTH &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(value) &&
    !RESERVED_SLUGS.has(value)
  );
}

/**
 * The practice a request path belongs to: `/anna` or `/anna/avatar.jpg` →
 * `anna`. Any other path (the app's own routes included) → undefined.
 */
export function practiceSlugOfPath(pathname: string) {
  const [, slug = "", rest = "", ...extra] = pathname.split("/");
  if (extra.length > 0 || (rest !== "" && rest !== "avatar.jpg")) {
    return undefined;
  }
  // Addresses are typed by hand: `/Anna` opens the page of `anna`.
  const lower = slug.toLowerCase();
  return isPracticeSlug(lower) ? lower : undefined;
}

/**
 * The old address of a booking page, `/p/<slug>…`, as the current one
 * (`/<slug>…`); undefined for any other path.
 */
export function legacyPracticePath(pathname: string) {
  const path = pathname.startsWith("/p/") ? pathname.slice(2) : undefined;
  return path && practiceSlugOfPath(path) ? path : undefined;
}

/** Addresses this short are premium names (`docs/premium-slugs.md`). */
export const PREMIUM_SLUG_MAX_LENGTH = 4;
/** The one-off price of a premium name, kopecks. */
export const PREMIUM_SLUG_PRICE = 990_00;
export const PREMIUM_SLUG_PRICE_LABEL = `${(PREMIUM_SLUG_PRICE / 100).toLocaleString("ru-RU")} ₽`;

/** Whether a valid address has to be bought. */
export function isPremiumSlug(slug: string) {
  return slug.length <= PREMIUM_SLUG_MAX_LENGTH;
}

export const practiceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(SLUG_MIN_LENGTH, "Адрес должен содержать не менее 3 символов")
  .max(SLUG_MAX_LENGTH, "Адрес не должен быть длиннее 48 символов")
  .regex(
    SLUG_PATTERN,
    "Только латинские буквы, цифры и дефис (не в начале и не в конце)",
  )
  .refine((slug) => !RESERVED_SLUGS.has(slug), "Этот адрес зарезервирован");

export const practiceSlugFormSchema = z.object({ slug: practiceSlugSchema });

export type PracticeSlugFormValues = z.infer<typeof practiceSlugFormSchema>;

export const practiceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Название должно содержать не менее 2 символов")
    .max(120, "Название не должно быть длиннее 120 символов"),
  slug: practiceSlugSchema,
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
    .email("Проверьте адрес почты — похоже, в нём опечатка"),
  note: z.string().trim().max(500).optional(),
});

export type GuestBookingFormInput = z.input<typeof guestBookingFormSchema>;
export type GuestBookingFormValues = z.infer<typeof guestBookingFormSchema>;

export const memberInviteFormSchema = z.object({
  email: z.email("Проверьте адрес почты — похоже, в нём опечатка"),
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

const googleCalendarId = z.string().trim().min(1).max(1024);

/**
 * Google Calendar sync: calendars whose busy time closes slots, and the one
 * bookings are written to (`primary` is the account's main calendar).
 */
export const googleCalendarFormSchema = z.object({
  busyCalendarIds: z
    .array(googleCalendarId)
    .max(50, "Не больше 50 календарей")
    .transform((ids) => [...new Set(ids)]),
  eventsCalendarId: googleCalendarId,
  exportBookings: z.boolean(),
});

export type GoogleCalendarFormValues = z.input<typeof googleCalendarFormSchema>;

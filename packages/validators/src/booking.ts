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

/**
 * How many hours before the start a client may still cancel or move a paid
 * booking themselves and get it back (`practices.cancel_hours`).
 */
export const CANCEL_HOURS = [3, 6, 12, 24, 48, 72] as const;

/** What every practice had before the owner could choose. */
export const DEFAULT_CANCEL_HOURS = 24;

export const cancelHoursSchema = z
  .number()
  .int()
  .refine(
    (h) => (CANCEL_HOURS as readonly number[]).includes(h),
    "Выберите срок из списка",
  );

/**
 * A practice's terms for a client cancelling on their own:
 * `cancelHours` — the deadline for a cancellation with the credit back;
 * `lateCancel` — after it, the client may still cancel, the credit is not
 * returned (`late_cancel`); off — only staff can.
 */
export interface CancelRules {
  cancelHours: number;
  lateCancel: boolean;
}

export const cancelRulesSchema = z.object({
  cancelHours: cancelHoursSchema,
  lateCancel: z.boolean(),
});

/**
 * Upcoming bookings paid at the visit one person (account or phone) may hold
 * at a practice (`booking.bookAtVisit`): nothing is paid, so this keeps a
 * stranger from filling the schedule.
 */
export const AT_VISIT_MAX_UPCOMING = 3;

/**
 * How a client may cancel their booking themselves at `now` (ms):
 * - `refund` — and get back what it took: a paid one up to `cancelHours`
 *   before the start; one that took nothing (a free intro, paid at the
 *   visit, `credits` 0) until it starts;
 * - `forfeit` — later than that, when the practice allows late cancelling:
 *   the credit is not returned;
 * - null — not alone: it has begun, or it is late and only staff may.
 * `booking.cancel`, the guest link, the cabinet and the messenger share it.
 */
export function clientCancel(
  booking: { kind: string; credits: number; startsAt: Date },
  now: number,
  rules: CancelRules,
): "refund" | "forfeit" | null {
  const left = booking.startsAt.getTime() - now;
  if (left <= 0) return null;
  if (booking.kind === "free" || booking.credits === 0) return "refund";
  if (left >= rules.cancelHours * 3_600_000) return "refund";
  return rules.lateCancel ? "forfeit" : null;
}

/**
 * Whether a client may move their booking themselves: only while it could
 * be cancelled with the credit back — a late move would dodge the rule.
 */
export function clientMayMove(
  booking: { kind: string; credits: number; startsAt: Date },
  now: number,
  rules: CancelRules,
) {
  return clientCancel(booking, now, rules) === "refund";
}

/** «меньше 3 часов», «меньше 24 часов» — the genitive after «меньше». */
export function formatHoursLess(hours: number) {
  const one = hours % 10 === 1 && hours % 100 !== 11;
  return `меньше ${hours} ${one ? "часа" : "часов"}`;
}

/** «за 3 часа», «за 12 часов», «за 24 часа». */
export function formatCancelHours(hours: number) {
  return `за ${hours} ${pluralize(hours, ["час", "часа", "часов"])}`;
}

/**
 * Slugs are the address of a booking page (`synoro.ru/<slug>`). So every
 * top-level route of the app and of the landing, and every name that would
 * pass for the platform's own page, is off limits. A new top-level route goes
 * here first, or a specialist can take its address
 * (`apps/app/src/lib/app-roots.test.ts` checks the existing ones).
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

/**
 * How clients reach the specialist (`practices.client_contact`): a phone,
 * Telegram, anything — free text, shown as is. Empty means none (null).
 */
export const practiceContactSchema = z
  .string()
  .trim()
  .max(200, "Контакт не должен быть длиннее 200 символов")
  .transform((value) => value || null);

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

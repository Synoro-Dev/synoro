import { z } from "zod";

import { guestBookingFormSchema } from "./booking";

/**
 * The waiting list (`waitlist_entries`): someone who found no suitable time
 * leaves a wish — dates, optionally hours of the day, optionally a service —
 * and is told once when matching time frees up.
 */

/** How far ahead a wish may reach, in days (both ends included). */
export const WAITLIST_MAX_DAYS = 60;

/** Open wishes one person may have at a practice at once. */
export const WAITLIST_MAX_ENTRIES = 3;

const DAY_MS = 86_400_000;

const halfHour = z
  .number()
  .int()
  .refine((m) => m % 30 === 0, "Время должно быть кратно 30 минутам");

const wishFields = z.object({
  /** Local days of the practice, YYYY-MM-DD. */
  fromDate: z.iso.date(),
  toDate: z.iso.date(),
  /** Minutes since local midnight; null — no limit on that side. */
  fromMinute: halfHour.min(0).max(1410).nullable().default(null),
  toMinute: halfHour.min(30).max(1440).nullable().default(null),
  /** The service wanted; the practice's first one when missing. */
  serviceId: z.uuid().optional(),
});

type Wish = z.infer<typeof wishFields>;

function checkWish(wish: Wish, ctx: z.RefinementCtx) {
  if (wish.toDate < wish.fromDate) {
    ctx.addIssue({
      code: "custom",
      path: ["toDate"],
      message: "Последний день не может быть раньше первого",
    });
    return;
  }
  const days =
    (Date.parse(`${wish.toDate}T00:00:00Z`) -
      Date.parse(`${wish.fromDate}T00:00:00Z`)) /
      DAY_MS +
    1;
  if (days > WAITLIST_MAX_DAYS) {
    ctx.addIssue({
      code: "custom",
      path: ["toDate"],
      message: `Выберите не больше ${WAITLIST_MAX_DAYS} дней`,
    });
  }
  if (
    wish.fromMinute !== null &&
    wish.toMinute !== null &&
    wish.fromMinute >= wish.toMinute
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["toMinute"],
      message: "«До» должно быть позже «с»",
    });
  }
}

/** The wish alone: what a signed-in client sends. */
export const waitlistWishSchema = wishFields.superRefine(checkWish);

/**
 * The wish and who is asking: a visitor leaves name, phone and email as when
 * booking; a signed-in client's own account is used and these are ignored.
 */
export const waitlistJoinSchema = wishFields
  .extend(
    guestBookingFormSchema.pick({ name: true, phone: true, email: true }).shape,
  )
  .superRefine(checkWish);

export type WaitlistWish = z.infer<typeof waitlistWishSchema>;
export type WaitlistJoinInput = z.input<typeof waitlistJoinSchema>;
export type WaitlistJoinValues = z.infer<typeof waitlistJoinSchema>;

/**
 * Whether a freed booking [`startsAt`, `endsAt`) fits a wish, given the
 * practice's local date and minutes for both ends and how long the wished
 * service takes. Pure, so the worker and tests share it.
 */
export function wishFits(
  wish: Pick<Wish, "fromDate" | "toDate" | "fromMinute" | "toMinute">,
  slot: {
    /** Local date (YYYY-MM-DD) and minutes since midnight of the start. */
    date: string;
    startMinute: number;
    /** Minutes since the start's local midnight at the end (may pass 1440). */
    endMinute: number;
  },
  wishedMinutes: number,
) {
  if (slot.date < wish.fromDate || slot.date > wish.toDate) return false;
  if (slot.endMinute - slot.startMinute < wishedMinutes) return false;
  if (wish.fromMinute !== null && slot.startMinute < wish.fromMinute) {
    return false;
  }
  // The wished meeting must end by `toMinute`; it starts where the slot does.
  if (
    wish.toMinute !== null &&
    slot.startMinute + wishedMinutes > wish.toMinute
  ) {
    return false;
  }
  return true;
}

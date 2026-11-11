import { z } from "zod";

import { guestBookingFormSchema } from "./booking";
import { serviceStepMinutes } from "./service";

/**
 * The waiting list (`waitlist_entries`): someone who found no suitable time
 * leaves a wish — dates, optionally hours of the day, optionally a service —
 * and is told once when matching time frees up.
 */

/** How far ahead a wish may reach, in days (both ends included). */
export const WAITLIST_MAX_DAYS = 60;

/** Open wishes one person may have at a practice at once. */
export const WAITLIST_MAX_ENTRIES = 3;

/**
 * How long a visitor's wish waits for the emailed confirmation: after that the
 * link is dead and the wish is gone (`waitlist_entries.confirmed_at`).
 */
export const WAITLIST_CONFIRM_HOURS = 24;

/** Wishes a visitor may have waiting for confirmation at a practice at once. */
export const WAITLIST_MAX_PENDING = 3;

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

/** What a visitor leaves besides the wish, as when booking. */
export const waitlistGuestSchema = guestBookingFormSchema.pick({
  name: true,
  phone: true,
  email: true,
});

/**
 * The wish and a phone. A signed-in client's own account is used, so their
 * name and email are neither sent nor checked (an account may be named «a»);
 * a visitor must send both, and `waitlist.join` checks them with
 * `waitlistGuestSchema`.
 */
export const waitlistJoinSchema = wishFields
  .extend({
    phone: guestBookingFormSchema.shape.phone,
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .superRefine(checkWish);

export type WaitlistWish = z.infer<typeof waitlistWishSchema>;
export type WaitlistJoinInput = z.input<typeof waitlistJoinSchema>;
export type WaitlistJoinValues = z.infer<typeof waitlistJoinSchema>;

/**
 * The first time a wished meeting could start inside a free stretch of the
 * practice's day, or null when none fits. `slot` is the stretch as the
 * practice's local date and minutes since midnight; `wishedMinutes` is the
 * wished service's length. Starts are on the service's grid
 * (`serviceStepMinutes`), so what is offered is what the booking page would
 * offer, and the wish's hours (`fromMinute` for the start, `toMinute` for
 * the end) are honoured. Pure, so the worker and tests share it.
 */
export function wishStart(
  wish: Pick<Wish, "fromDate" | "toDate" | "fromMinute" | "toMinute">,
  slot: { date: string; startMinute: number; endMinute: number },
  wishedMinutes: number,
): number | null {
  if (slot.date < wish.fromDate || slot.date > wish.toDate) return null;
  const step = serviceStepMinutes(wishedMinutes);
  for (
    let start = Math.ceil(slot.startMinute / step) * step;
    start + wishedMinutes <= slot.endMinute;
    start += step
  ) {
    if (wish.fromMinute !== null && start < wish.fromMinute) continue;
    // Later starts only end later.
    if (wish.toMinute !== null && start + wishedMinutes > wish.toMinute) break;
    return start;
  }
  return null;
}

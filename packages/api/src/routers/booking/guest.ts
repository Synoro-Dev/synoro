import {
  and,
  Booking,
  type Database,
  desc,
  eq,
  inArray,
  Payment,
  Practice,
  PracticeMember,
  user,
} from "@synoro/db";
import { clientCancel } from "@synoro/validators";
import { z } from "zod";

import {
  cancelActiveBooking,
  cancelTerms,
  tooLateMessage,
} from "../../lib/bookings";
import { hashGuestToken } from "../../lib/guests";
import { syncPayment } from "../../lib/payments";
import { publicProcedure } from "../../orpc";

const tokenInput = z.object({ token: z.string().min(16).max(64) });

/** `ivan@example.com` → `i***@example.com`: enough to recognise, not to leak. */
function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  return `${name.charAt(0)}***@${domain}`;
}

function findByToken(db: Database, token: string) {
  return db
    .select({
      id: Booking.id,
      kind: Booking.kind,
      credits: Booking.credits,
      status: Booking.status,
      cancelReason: Booking.cancelReason,
      holdUntil: Booking.holdUntil,
      meetingUrl: Booking.meetingUrl,
      practiceVideoUrl: Practice.videoUrl,
      practiceContact: Practice.clientContact,
      startsAt: Booking.startsAt,
      endsAt: Booking.endsAt,
      clientTimezone: Booking.clientTimezone,
      practiceName: Practice.name,
      practiceSlug: Practice.slug,
      timezone: Practice.timezone,
      profession: Practice.profession,
      cancelHours: Practice.cancelHours,
      lateCancel: Practice.lateCancel,
      clientName: user.name,
      clientEmail: user.email,
      balance: PracticeMember.credits,
    })
    .from(Booking)
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(
      and(
        eq(Booking.accessTokenHash, hashGuestToken(token)),
        inArray(Booking.kind, ["consultation", "free"]),
      ),
    )
    .then((rows) => rows[0]);
}

/**
 * A visitor's booking by the secret in their link — no sign-in. Also checks
 * a pending payment with the provider, so the page the visitor returns to
 * from the payment form shows the result even before the webhook.
 *
 * `state`:
 * - awaiting_payment — the time is held until `holdUntil`;
 * - confirmed        — paid and booked;
 * - expired          — not paid in time, the time was released;
 * - cancelled        — cancelled after payment: the paid consultation is on
 *                      the visitor's balance (also when the hold ran out
 *                      before the money arrived).
 *
 * `kind` is `free` for a free intro (`bookIntro`): confirmed from the
 * start, no payment and no balance involved — only `confirmed` or
 * `cancelled`. So is a booking paid at the visit (`bookAtVisit`,
 * `charged: false`): nothing was taken, and it says nothing of the balance.
 *
 * @example client.booking.guest({ token })
 */
export const guest = publicProcedure
  .errors({ NOT_FOUND: { message: "Запись не найдена" } })
  .input(tokenInput)
  .handler(async ({ context, input, errors }) => {
    let found = await findByToken(context.db, input.token);
    if (!found) throw errors.NOT_FOUND();

    const payment = await context.db.query.Payment.findFirst({
      where: eq(Payment.bookingId, found.id),
      orderBy: desc(Payment.createdAt),
    });
    if (payment?.status === "pending") {
      await syncPayment(context.db, payment);
      found = (await findByToken(context.db, input.token)) ?? found;
    }
    const paid = payment
      ? (
          await context.db.query.Payment.findFirst({
            where: eq(Payment.id, payment.id),
            columns: { status: true },
          })
        )?.status === "succeeded"
      : false;

    const now = Date.now();
    const held = found.holdUntil !== null;
    const state =
      found.status === "cancelled"
        ? // Nothing to pay (intro, paid at the visit): never an unpaid hold.
          paid || found.credits === 0
          ? ("cancelled" as const)
          : ("expired" as const)
        : !held
          ? ("confirmed" as const)
          : (found.holdUntil?.getTime() ?? 0) > now
            ? ("awaiting_payment" as const)
            : ("expired" as const);

    return {
      state,
      kind: found.kind,
      /** Something was taken for it: false for an intro or a visit-paid booking. */
      charged: found.credits > 0,
      /** What it took from the balance, for the words on a late cancel. */
      credits: found.credits,
      /** Cancelled late by the client: the credit was not given back. */
      forfeited: found.cancelReason === "late_cancel",
      startsAt: found.startsAt,
      endsAt: found.endsAt,
      /** The zone the visitor booked from: the page reads times in it. */
      clientTimezone: found.clientTimezone,
      holdUntil: found.holdUntil,
      ...cancelTerms(state === "confirmed", found, now, found),
      /** The video room, only once the booking is confirmed. */
      videoUrl:
        state === "confirmed"
          ? (found.meetingUrl ?? found.practiceVideoUrl)
          : null,
      /** How to reach the specialist, only once the booking is confirmed. */
      contact: state === "confirmed" ? found.practiceContact : null,
      balance: found.balance,
      name: found.clientName,
      email: maskEmail(found.clientEmail),
      practice: {
        name: found.practiceName,
        slug: found.practiceSlug,
        timezone: found.timezone,
        profession: found.profession,
      },
      /** Resume the payment form while the time is still held. */
      payUrl:
        state === "awaiting_payment" && payment?.status === "pending"
          ? payment.confirmationUrl
          : null,
    };
  });

/**
 * Cancel a visitor's confirmed booking by the secret in their link, at the
 * same terms as a signed-in client: up to the practice's deadline with the
 * consultation back on their balance; later, where the practice allows it,
 * only with `forfeit: true` and without it (`late_cancel`). A free intro, and
 * a booking paid at the visit, may be cancelled until it starts.
 *
 * @example client.booking.cancelGuest({ token })
 */
export const cancelGuest = publicProcedure
  .errors({
    NOT_FOUND: { message: "Запись не найдена или уже отменена" },
    TOO_LATE: {
      message: "Отменить запись уже нельзя — обратитесь к специалисту",
    },
  })
  .input(
    tokenInput.extend({
      /** Cancel after the deadline knowing the credit won't come back. */
      forfeit: z.boolean().default(false),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const found = await findByToken(context.db, input.token);
    if (!found || found.status !== "active" || found.holdUntil !== null) {
      throw errors.NOT_FOUND();
    }
    const tooLate = () =>
      errors.TOO_LATE({ message: tooLateMessage("cancel", found) });
    const terms = clientCancel(found, Date.now(), found);
    if (!terms || (terms === "forfeit" && !input.forfeit)) throw tooLate();
    const late = terms === "forfeit";

    const result = await cancelActiveBooking(context.db, found.id, {
      cancelledById: null,
      refund: !late,
      reason: late ? "late_cancel" : "client",
      startsAt: found.startsAt,
    });
    if (!result) {
      // Moved meanwhile: the deadline is asked again for the new time.
      const now = await findByToken(context.db, input.token);
      if (now?.status === "active" && !clientCancel(now, Date.now(), now)) {
        throw tooLate();
      }
      throw errors.NOT_FOUND();
    }
    return { refunded: result.refunded };
  });

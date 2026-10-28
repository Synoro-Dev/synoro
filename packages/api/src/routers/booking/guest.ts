import {
  and,
  Booking,
  type Database,
  desc,
  eq,
  Payment,
  Practice,
  PracticeMember,
  user,
} from "@synoro/db";
import { z } from "zod";

import { cancelActiveBooking } from "../../lib/bookings";
import { hashGuestToken } from "../../lib/guests";
import { syncPayment } from "../../lib/payments";
import { CLIENT_CANCEL_WINDOW_MS } from "../../lib/schedule";
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
      status: Booking.status,
      holdUntil: Booking.holdUntil,
      meetingUrl: Booking.meetingUrl,
      practiceVideoUrl: Practice.videoUrl,
      startsAt: Booking.startsAt,
      endsAt: Booking.endsAt,
      practiceName: Practice.name,
      practiceSlug: Practice.slug,
      timezone: Practice.timezone,
      profession: Practice.profession,
      clientName: user.name,
      clientEmail: user.email,
      credits: PracticeMember.credits,
    })
    .from(Booking)
    .innerJoin(Practice, eq(Practice.id, Booking.practiceId))
    .innerJoin(PracticeMember, eq(PracticeMember.id, Booking.memberId))
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(
      and(
        eq(Booking.accessTokenHash, hashGuestToken(token)),
        eq(Booking.kind, "consultation"),
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
        ? paid
          ? ("cancelled" as const)
          : ("expired" as const)
        : !held
          ? ("confirmed" as const)
          : (found.holdUntil?.getTime() ?? 0) > now
            ? ("awaiting_payment" as const)
            : ("expired" as const);

    return {
      state,
      startsAt: found.startsAt,
      endsAt: found.endsAt,
      holdUntil: found.holdUntil,
      canCancel:
        state === "confirmed" &&
        found.startsAt.getTime() - now >= CLIENT_CANCEL_WINDOW_MS,
      /** The video room, only once the booking is confirmed. */
      videoUrl:
        state === "confirmed"
          ? (found.meetingUrl ?? found.practiceVideoUrl)
          : null,
      balance: found.credits,
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
 * same terms as a signed-in client: up to 24 h before the start, and the
 * consultation goes back to their balance.
 *
 * @example client.booking.cancelGuest({ token })
 */
export const cancelGuest = publicProcedure
  .errors({
    NOT_FOUND: { message: "Запись не найдена или уже отменена" },
    TOO_LATE: {
      message:
        "Отменить запись можно не позднее чем за 24 часа до начала — обратитесь к специалисту",
    },
  })
  .input(tokenInput)
  .handler(async ({ context, input, errors }) => {
    const found = await findByToken(context.db, input.token);
    if (!found || found.status !== "active" || found.holdUntil !== null) {
      throw errors.NOT_FOUND();
    }
    if (found.startsAt.getTime() - Date.now() < CLIENT_CANCEL_WINDOW_MS) {
      throw errors.TOO_LATE();
    }

    const result = await cancelActiveBooking(context.db, found.id, {
      cancelledById: null,
      refund: true,
    });
    if (!result) throw errors.NOT_FOUND();
    return { refunded: result.refunded };
  });

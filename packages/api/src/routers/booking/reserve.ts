import { logger } from "@synoro/config";
import {
  and,
  Booking,
  count,
  eq,
  gt,
  isExclusionViolation,
  isNotNull,
  PaymentPackage,
} from "@synoro/db";
import { dispatchEmail } from "@synoro/jobs";
import { guestBookingFormSchema } from "@synoro/validators";
import { z } from "zod";

import { track } from "../../lib/analytics";
import { HOLD_MS, loadRules, releaseExpiredHolds } from "../../lib/bookings";
import { isBusyInGoogle } from "../../lib/google-calendar";
import {
  findOrCreateGuestMember,
  hashGuestToken,
  newGuestToken,
} from "../../lib/guests";
import {
  guestReturnUrl,
  ProviderError,
  payableAccount,
  providerFailureMessage,
  startPayment,
} from "../../lib/payments";
import { findPractice } from "../../lib/practice-access";
import { isScheduledSlot, SLOT_MINUTES } from "../../lib/schedule";
import { cabinetUrl, guestBookingUrl } from "../../lib/urls";
import { publicProcedure } from "../../orpc";

/** One visitor cannot hold more unpaid times than this at once. */
const MAX_OPEN_HOLDS = 2;

const formatIn = (
  at: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) => new Intl.DateTimeFormat("ru-RU", { timeZone, ...options }).format(at);

/**
 * Mail the visitor the link that opens their booking without signing in. A
 * mail failure must not undo the booking — the payment page they land on
 * leads back to the same link — so it is only logged.
 */
async function sendBookingLink(input: {
  email: string;
  name: string;
  practiceName: string;
  timeZone: string;
  startsAt: Date;
  holdUntil: Date | null;
  token: string;
}) {
  try {
    await dispatchEmail({
      template: "booking-link",
      to: [input.email],
      subject: `Ваша запись: ${input.practiceName}`,
      props: {
        name: input.name,
        practiceName: input.practiceName,
        when: formatIn(input.startsAt, input.timeZone, {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        }),
        holdUntil: input.holdUntil
          ? formatIn(input.holdUntil, input.timeZone, {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        bookingUrl: guestBookingUrl(input.token),
        cabinetUrl: cabinetUrl(),
      },
    });
  } catch (error) {
    logger.warn("booking.link_email_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Book an hour as a visitor, without signing in: reserve the time and open
 * the online payment for a package. The time is held for 15 minutes; once the
 * payment succeeds (webhook or the status check on the visitor's page) the
 * booking is confirmed and one credit of the package is spent on it, the rest
 * stay on the visitor's balance.
 *
 * The visitor becomes a passive client of the practice (see
 * `findOrCreateGuestMember`); `token` opens `/b/<token>`, their booking page.
 *
 * @example client.booking.reserve({ practiceId, packageId, startsAt, name: "Иван", phone: "+7 900 000-00-00", email: "ivan@example.com" })
 */
export const reserve = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика или пакет не найдены — обновите страницу" },
    PAYMENTS_DISABLED: {
      message: "Специалист пока не принимает оплату онлайн",
    },
    SLOT_UNAVAILABLE: { message: "Это время недоступно для записи" },
    SIGN_IN_REQUIRED: {
      message: "Эта почта принадлежит специалисту практики — войдите в аккаунт",
    },
    TOO_MANY_HOLDS: {
      message: "У вас уже есть неоплаченные записи — оплатите их или подождите",
    },
    PROVIDER_ERROR: {
      message: "Платёжная система не приняла платёж, попробуйте позже",
    },
  })
  .input(
    guestBookingFormSchema.extend({
      practiceId: z.uuid(),
      packageId: z.uuid(),
      startsAt: z.date(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const practice = await findPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();

    const [account, pkg] = await Promise.all([
      payableAccount(context.db, practice),
      context.db.query.PaymentPackage.findFirst({
        where: and(
          eq(PaymentPackage.id, input.packageId),
          eq(PaymentPackage.practiceId, practice.id),
        ),
      }),
    ]);
    if (!account) throw errors.PAYMENTS_DISABLED();
    if (!pkg) throw errors.NOT_FOUND();

    const rules = await loadRules(context.db, practice.id);
    const scheduled = isScheduledSlot({
      rules,
      startsAt: input.startsAt,
      timeZone: practice.timezone,
      kind: "consultation",
      now: new Date(),
    });
    if (!scheduled) throw errors.SLOT_UNAVAILABLE();
    const endsAt = new Date(
      input.startsAt.getTime() + SLOT_MINUTES.consultation * 60_000,
    );
    const range = { startsAt: input.startsAt, endsAt };
    if (await isBusyInGoogle(context.db, practice.id, range)) {
      throw errors.SLOT_UNAVAILABLE();
    }

    await releaseExpiredHolds(context.db, practice.id);

    const guest = await findOrCreateGuestMember(context.db, practice.id, input);
    if (guest.staff) throw errors.SIGN_IN_REQUIRED();

    const [open] = await context.db
      .select({ holds: count() })
      .from(Booking)
      .where(
        and(
          eq(Booking.memberId, guest.memberId),
          eq(Booking.status, "active"),
          isNotNull(Booking.holdUntil),
          gt(Booking.holdUntil, new Date()),
        ),
      );
    if ((open?.holds ?? 0) >= MAX_OPEN_HOLDS) throw errors.TOO_MANY_HOLDS();

    const token = newGuestToken();
    let booking: typeof Booking.$inferSelect | undefined;
    try {
      [booking] = await context.db
        .insert(Booking)
        .values({
          practiceId: practice.id,
          kind: "consultation",
          startsAt: input.startsAt,
          endsAt,
          memberId: guest.memberId,
          guestPhone: input.phone,
          note: input.note || null,
          holdUntil: new Date(Date.now() + HOLD_MS),
          accessTokenHash: hashGuestToken(token),
          createdById: guest.user.id,
        })
        .returning();
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
    if (!booking) throw new Error("Failed to insert booking");

    try {
      const { confirmationUrl } = await startPayment(context.db, {
        practice,
        account,
        pkg,
        memberId: guest.memberId,
        user: guest.user,
        bookingId: booking.id,
        returnUrl: () => guestReturnUrl(token),
      });
      await sendBookingLink({
        email: guest.user.email,
        name: input.name,
        practiceName: practice.name,
        timeZone: practice.timezone,
        startsAt: input.startsAt,
        holdUntil: booking.holdUntil,
        token,
      });
      track("booking_reserved", guest.user.id, {
        bookingId: booking.id,
        practiceId: practice.id,
        packageId: pkg.id,
      });
      return { token, confirmationUrl, holdUntil: booking.holdUntil };
    } catch (error) {
      // Nothing was charged: give the time back instead of holding it.
      await context.db.delete(Booking).where(eq(Booking.id, booking.id));
      if (!(error instanceof ProviderError)) throw error;
      logger.warn("payment.create_failed", {
        practiceId: practice.id,
        provider: account.provider,
        kind: error.kind,
        error: error.message,
      });
      throw errors.PROVIDER_ERROR({
        message: providerFailureMessage(error),
        cause: error,
      });
    }
  });

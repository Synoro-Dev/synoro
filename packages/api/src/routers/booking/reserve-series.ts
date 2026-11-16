import { logger } from "@synoro/config";
import {
  and,
  Booking,
  BookingSeries,
  eq,
  isExclusionViolation,
  PaymentPackage,
} from "@synoro/db";
import {
  bookingAnswersInput,
  clientTimeZoneInput,
  consentsInput,
  guestBookingFormSchema,
} from "@synoro/validators";
import { z } from "zod";

import { track } from "../../lib/analytics";
import { ANSWERS_INVALID, bookingAnswers } from "../../lib/booking-questions";
import { HOLD_MS, releaseExpiredHolds } from "../../lib/bookings";
import {
  CONSENTS_REQUIRED,
  checkConsents,
  recordConsents,
} from "../../lib/consents";
import {
  findOrCreateGuestMember,
  hashGuestToken,
  holdsAtLimit,
  newGuestToken,
  sendBookingLink,
} from "../../lib/guests";
import {
  guestReturnUrl,
  ProviderError,
  payableAccount,
  providerFailureMessage,
  startPayment,
} from "../../lib/payments";
import { findOpenPractice } from "../../lib/practice-access";
import { previewSeries, SERIES_MAX } from "../../lib/series";
import { resolveService } from "../../lib/services";
import { publicProcedure } from "../../orpc";
import { seriesInput } from "./series-preview";

/**
 * Book a recurring consultation as a visitor, without signing in: hold every
 * date for 15 minutes and open the online payment for a package. Once the
 * payment succeeds all the held bookings are confirmed at once and one price
 * per booking is spent from the package; what is left stays on the visitor's
 * balance. Not paid in time — every date is released together.
 *
 * `reserve` for one time, this for `count` dates (minus `skip`, at least two)
 * at the same local time every week or every other week. The package must
 * cover them all (PACKAGE_TOO_SMALL). SLOT_UNAVAILABLE lists the dates that
 * can't be booked, as in `bookSeries`. A series is one open hold, whatever
 * the number of dates (`TOO_MANY_HOLDS`). `token` opens `/b/<token>` on the
 * first booking.
 *
 * @example client.booking.reserveSeries({ practiceId, packageId, startsAt, intervalWeeks: 1, count: 8, name: "Иван", phone: "+7 900 000-00-00", email: "ivan@example.com" })
 */
export const reserveSeries = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика или пакет не найдены — обновите страницу" },
    PAYMENTS_DISABLED: {
      message: "Специалист пока не принимает оплату онлайн",
    },
    SLOT_UNAVAILABLE: {
      message:
        "Некоторые даты недоступны — уберите их или выберите другое время",
      data: z.object({ dates: z.array(z.date()) }),
    },
    TOO_FEW: { message: "Для повторной записи нужно хотя бы две даты" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
    PACKAGE_TOO_SMALL: {
      message: "В этом пакете не хватает занятий на все выбранные даты",
    },
    SIGN_IN_REQUIRED: {
      message: "Эта почта принадлежит специалисту практики — войдите в аккаунт",
    },
    TOO_MANY_HOLDS: {
      message: "У вас уже есть неоплаченные записи — оплатите их или подождите",
    },
    PROVIDER_ERROR: {
      message: "Платёжная система не приняла платёж, попробуйте позже",
    },
    ANSWERS_INVALID,
    CONSENTS_REQUIRED,
  })
  .input(
    guestBookingFormSchema.extend(
      seriesInput.omit({ memberId: true }).extend({
        packageId: z.uuid(),
        /** Dates of the series left out on purpose. */
        skip: z.array(z.date()).max(SERIES_MAX).default([]),
        answers: bookingAnswersInput,
        /** The practice's documents the client ticked (`consentsInput`). */
        consents: consentsInput,
        /** The visitor's browser zone: the mails write the time in it. */
        timezone: clientTimeZoneInput,
      }).shape,
    ),
  )
  .handler(async ({ context, input, errors }) => {
    const practice = await findOpenPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    // Paid at the visit: the page books with `bookAtVisit` instead.
    if (practice.payAtVisit) throw errors.PAYMENTS_DISABLED();

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
    const service = await resolveService(
      context.db,
      practice.id,
      input.serviceId,
    );
    if (!service) throw errors.SERVICE_NOT_FOUND();
    const questionnaire = await bookingAnswers(
      context.db,
      practice,
      input.answers,
    );
    if (questionnaire.errors) {
      throw errors.ANSWERS_INVALID({ data: { errors: questionnaire.errors } });
    }
    // The practice's documents, accepted by the client alone.
    const consents = await checkConsents(
      context.db,
      practice,
      null,
      input.consents,
    );
    if (consents.missing.length > 0) {
      throw errors.CONSENTS_REQUIRED({
        data: { documentIds: consents.missing },
      });
    }

    const skipped = new Set(input.skip.map((d) => d.getTime()));
    const dates = (
      await previewSeries(
        context.db,
        practice,
        { ...input, minutes: service.minutes },
        { checkGoogle: true },
      )
    ).filter((d) => !skipped.has(d.startsAt.getTime()));
    if (dates.length < 2) throw errors.TOO_FEW();
    const blocked = dates.filter((d) => d.status !== "free");
    if (blocked.length > 0) {
      throw errors.SLOT_UNAVAILABLE({
        data: { dates: blocked.map((d) => d.startsAt) },
      });
    }
    // The payment spends the service's price on each date; a smaller package
    // would leave the balance below zero.
    if (pkg.credits < dates.length * service.credits) {
      throw errors.PACKAGE_TOO_SMALL();
    }

    await releaseExpiredHolds(context.db, practice.id);

    const guest = await findOrCreateGuestMember(context.db, practice.id, input);
    if (guest.staff) throw errors.SIGN_IN_REQUIRED();

    const token = newGuestToken();
    const holdUntil = new Date(Date.now() + HOLD_MS);
    let created: { seriesId: string; firstId: string };
    try {
      // One transaction: the series, its bookings and the consents stand or
      // fall together.
      created = await context.db.transaction(async (tx) => {
        // The limit is checked under the visitor's lock, so parallel requests
        // can't each see room for one more.
        if (await holdsAtLimit(tx, guest.memberId)) {
          throw errors.TOO_MANY_HOLDS();
        }
        const [series] = await tx
          .insert(BookingSeries)
          .values({
            practiceId: practice.id,
            memberId: guest.memberId,
            intervalWeeks: input.intervalWeeks,
            count: dates.length,
            createdById: guest.user.id,
          })
          .returning({ id: BookingSeries.id });
        if (!series) throw new Error("Failed to insert series");
        const rows = await tx
          .insert(Booking)
          .values(
            dates.map((d, i) => ({
              practiceId: practice.id,
              kind: "consultation" as const,
              serviceId: service.id,
              credits: service.credits,
              startsAt: d.startsAt,
              endsAt: d.endsAt,
              memberId: guest.memberId,
              guestPhone: input.phone,
              note: input.note || null,
              answers: questionnaire.answers,
              clientTimezone: input.timezone ?? null,
              holdUntil,
              seriesId: series.id,
              // The visitor's link opens the first booking.
              accessTokenHash: i === 0 ? hashGuestToken(token) : null,
              createdById: guest.user.id,
            })),
          )
          .returning({ id: Booking.id, startsAt: Booking.startsAt });
        const [first] = [...rows].sort(
          (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
        );
        if (!first) throw new Error("Failed to insert bookings");
        await recordConsents(tx, {
          practiceId: practice.id,
          memberId: guest.memberId,
          bookingId: first.id,
          accept: consents.accept,
          headers: context.headers,
          bySession: false,
        });
        return { seriesId: series.id, firstId: first.id };
      });
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ data: { dates: [] }, cause: error });
      }
      throw error;
    }
    const { firstId } = created;

    try {
      const { confirmationUrl } = await startPayment(context.db, {
        practice,
        account,
        pkg,
        memberId: guest.memberId,
        user: guest.user,
        bookingId: firstId,
        seriesId: created.seriesId,
        returnUrl: () => guestReturnUrl(token),
      });
      await sendBookingLink({
        email: guest.user.email,
        name: input.name,
        practiceName: practice.name,
        timeZone: input.timezone ?? practice.timezone,
        startsAt: dates[0]?.startsAt ?? input.startsAt,
        dates: dates.map((d) => d.startsAt),
        holdUntil,
        token,
      });
      track("booking_reserved", guest.user.id, {
        bookingId: firstId,
        practiceId: practice.id,
        packageId: pkg.id,
        series: dates.length,
      });
      return {
        token,
        confirmationUrl,
        holdUntil,
        dates: dates.map((d) => d.startsAt),
      };
    } catch (error) {
      // Nothing was charged: give the dates back instead of holding them.
      await context.db
        .delete(Booking)
        .where(eq(Booking.seriesId, created.seriesId));
      await context.db
        .delete(BookingSeries)
        .where(eq(BookingSeries.id, created.seriesId));
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

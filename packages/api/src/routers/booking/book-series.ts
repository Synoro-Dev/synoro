import {
  Booking,
  BookingSeries,
  CreditEntry,
  eq,
  isExclusionViolation,
  user,
} from "@synoro/db";
import { notifySeriesBooked } from "@synoro/jobs/booking-video";
import {
  bookingAnswersInput,
  clientTimeZoneInput,
  consentsInput,
} from "@synoro/validators";
import { z } from "zod";

import { ANSWERS_INVALID, bookingAnswers } from "../../lib/booking-questions";
import { adjustCredits, releaseExpiredHolds } from "../../lib/bookings";
import {
  CONSENTS_REQUIRED,
  checkConsents,
  recordConsents,
} from "../../lib/consents";
import { exportBooking } from "../../lib/google-calendar";
import {
  findMembership,
  findOpenPractice,
  practiceProcedure,
} from "../../lib/practice-access";
import { previewSeries, SERIES_MAX, seriesMember } from "../../lib/series";
import { resolveService } from "../../lib/services";
import { seriesInput } from "./series-preview";

/**
 * Book a recurring consultation: the same local time every week or every
 * other week, `count` dates minus the ones in `skip`, at least two. All
 * bookings are made at once, in one transaction, the service's price in
 * credits each (`serviceId`, the first service when missing).
 *
 * SLOT_UNAVAILABLE lists the dates that can't be booked (off the schedule,
 * taken, busy in Google for clients, past): skip them or pick another time.
 * It is also raised, with no dates, when someone took a date between the
 * check and the insert (`bookings_no_overlap`); nothing is booked then.
 * NO_CREDITS when the balance doesn't cover every booking. Access, the phone,
 * the questionnaire (its answers go on every booking) and the Google check
 * as in `book`; so is payment at the visit: staff book without the balance
 * (`credits` 0 each), a client gets PAY_AT_VISIT.
 *
 * @example client.booking.bookSeries({ practiceId, startsAt, intervalWeeks: 1, count: 8 })
 */
export const bookSeries = practiceProcedure
  .errors({
    PHONE_REQUIRED: {
      message:
        "Укажите номер телефона в профиле — специалисту нужно связаться с вами",
    },
    NO_CREDITS: {
      message: "На балансе не хватает оплаченных занятий на все даты",
    },
    PAY_AT_VISIT: {
      message: "Специалист принимает оплату на приёме — обновите страницу",
    },
    SLOT_UNAVAILABLE: {
      message:
        "Некоторые даты недоступны — уберите их или выберите другое время",
      data: z.object({ dates: z.array(z.date()) }),
    },
    TOO_FEW: { message: "Для повторной записи нужно хотя бы две даты" },
    NOT_FOUND: { message: "Клиент не найден в этой практике" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
    ANSWERS_INVALID,
    CONSENTS_REQUIRED,
  })
  .input(
    seriesInput.extend({
      /** Dates of the series left out on purpose. */
      skip: z.array(z.date()).max(SERIES_MAX).default([]),
      note: z.string().trim().max(500).optional(),
      answers: bookingAnswersInput,
      /** The practice's documents the client ticked (`consentsInput`). */
      consents: consentsInput,
      /** The client's browser zone, for mails; not used when staff book. */
      timezone: clientTimeZoneInput,
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const [caller, practice] = await Promise.all([
      findMembership(context.db, input.practiceId, userId),
      findOpenPractice(context.db, input.practiceId),
    ]);
    if (!caller || !practice) throw errors.FORBIDDEN();
    const who = await seriesMember(
      context.db,
      practice.id,
      caller,
      input.memberId,
    );
    if (who.error) throw errors[who.error]();
    const { member, staff, forOther } = who;
    if (practice.payAtVisit && !forOther) throw errors.PAY_AT_VISIT();
    const service = await resolveService(
      context.db,
      practice.id,
      input.serviceId,
    );
    if (!service) throw errors.SERVICE_NOT_FOUND();
    // Staff booking a client reach them anyway; a client must leave a phone.
    if (!forOther) {
      const account = await context.db.query.user.findFirst({
        where: eq(user.id, userId),
        columns: { phone: true },
      });
      if (!account?.phone) throw errors.PHONE_REQUIRED();
    }
    // Staff booking a client skip the questionnaire: it's the client's to fill.
    const questionnaire = forOther
      ? { answers: null, errors: null }
      : await bookingAnswers(context.db, practice, input.answers);
    if (questionnaire.errors) {
      throw errors.ANSWERS_INVALID({ data: { errors: questionnaire.errors } });
    }
    // The practice's documents, accepted by the client alone.
    const consents = forOther
      ? null
      : await checkConsents(context.db, practice, member.id, input.consents);
    if (consents && consents.missing.length > 0) {
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
        { checkGoogle: !staff },
      )
    ).filter((d) => !skipped.has(d.startsAt.getTime()));
    if (dates.length < 2) throw errors.TOO_FEW();
    const blocked = dates.filter((d) => d.status !== "free");
    if (blocked.length > 0) {
      throw errors.SLOT_UNAVAILABLE({
        data: { dates: blocked.map((d) => d.startsAt) },
      });
    }

    await releaseExpiredHolds(context.db, practice.id);
    // Paid at the visit: the balance is neither needed nor touched.
    const price = practice.payAtVisit ? 0 : service.credits;
    let created: { seriesId: string; bookingIds: string[]; credits: number };
    try {
      created = await context.db.transaction(async (tx) => {
        const credits =
          price === 0
            ? member.credits
            : await adjustCredits(tx, member.id, -dates.length * price);
        if (credits === undefined) throw errors.NO_CREDITS();
        const [series] = await tx
          .insert(BookingSeries)
          .values({
            practiceId: practice.id,
            memberId: member.id,
            intervalWeeks: input.intervalWeeks,
            count: dates.length,
            createdById: userId,
          })
          .returning({ id: BookingSeries.id });
        if (!series) throw new Error("Failed to insert series");
        const bookings = await tx
          .insert(Booking)
          .values(
            dates.map((d) => ({
              practiceId: practice.id,
              kind: "consultation" as const,
              serviceId: service.id,
              credits: price,
              startsAt: d.startsAt,
              endsAt: d.endsAt,
              memberId: member.id,
              note: input.note,
              answers: questionnaire.answers,
              clientTimezone: forOther ? null : (input.timezone ?? null),
              seriesId: series.id,
              createdById: userId,
            })),
          )
          .returning({ id: Booking.id });
        // In the series' transaction: a failure here leaves no booking.
        const first = bookings[0];
        if (consents && first) {
          await recordConsents(tx, {
            practiceId: practice.id,
            memberId: member.id,
            bookingId: first.id,
            accept: consents.accept,
            headers: context.headers,
            bySession: true,
          });
        }
        if (price > 0) {
          await tx.insert(CreditEntry).values(
            bookings.map((b) => ({
              memberId: member.id,
              delta: -price,
              reason: "booking" as const,
              bookingId: b.id,
              createdById: userId,
            })),
          );
        }
        return {
          seriesId: series.id,
          bookingIds: bookings.map((b) => b.id),
          credits,
        };
      });
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ data: { dates: [] }, cause: error });
      }
      throw error;
    }

    // After the commit: Google and mails never undo the bookings.
    for (const id of created.bookingIds) await exportBooking(context.db, id);
    await notifySeriesBooked(context.db, created.bookingIds);

    return {
      seriesId: created.seriesId,
      dates: dates.map((d) => d.startsAt),
      credits: created.credits,
    };
  });

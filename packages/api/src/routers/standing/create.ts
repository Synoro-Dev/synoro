import {
  Booking,
  CreditEntry,
  eq,
  isExclusionViolation,
  StandingTime,
  user,
} from "@synoro/db";
import { notifySeriesBooked } from "@synoro/jobs/booking-video";
import {
  bookingAnswersInput,
  clientTimeZoneInput,
  consentsInput,
} from "@synoro/validators";
import { z } from "zod";
import { hasPro } from "../../lib/billing";
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
import { previewSeries, seriesMember } from "../../lib/series";
import { resolveService } from "../../lib/services";
import { extendStanding } from "../../lib/standing";

/**
 * Pin a time for a client with no end («Про»): the same local time every week
 * or every other week, `startsAt` and on, until it is ended (`standing.end`).
 * The first date is booked now from the balance, as `book` does (NO_CREDITS
 * without a credit; SLOT_UNAVAILABLE when it is off the schedule or taken);
 * the next four weeks are made at once and then kept up by the daily cron
 * (`extendStanding`): a date the balance pays for is confirmed, one it does not
 * is held until the client tops up (see `docs/standing-time.md`).
 *
 * A client pins their own time (a phone, the questionnaire and the practice's
 * documents as in `bookSeries`); staff pass `memberId` for a client. PRO_REQUIRED
 * when the owner's «Про» has run out.
 *
 * @example client.standing.create({ practiceId, startsAt, intervalWeeks: 1 })
 */
export const create = practiceProcedure
  .errors({
    PRO_REQUIRED: {
      message: "Постоянное время доступно на тарифе «Про»",
    },
    PHONE_REQUIRED: {
      message:
        "Укажите номер телефона в профиле — специалисту нужно связаться с вами",
    },
    NO_CREDITS: {
      message: "На балансе нет оплаченных занятий на первую дату",
    },
    SLOT_UNAVAILABLE: { message: "Это время недоступно для записи" },
    NOT_FOUND: { message: "Клиент не найден в этой практике" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
    ANSWERS_INVALID,
    CONSENTS_REQUIRED,
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      /** The first date; the rest follow at the same local time. */
      startsAt: z.date(),
      intervalWeeks: z.union([z.literal(1), z.literal(2)]),
      serviceId: z.uuid().optional(),
      /** Staff only: the client to pin the time for; defaults to the caller. */
      memberId: z.uuid().optional(),
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
    if (!(await hasPro(context.db, practice.ownerId))) {
      throw errors.PRO_REQUIRED();
    }
    const who = await seriesMember(
      context.db,
      practice.id,
      caller,
      input.memberId,
    );
    if (who.error) throw errors[who.error]();
    const { member, staff, forOther } = who;
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
    const consents = forOther
      ? null
      : await checkConsents(context.db, practice, member.id, input.consents);
    if (consents && consents.missing.length > 0) {
      throw errors.CONSENTS_REQUIRED({
        data: { documentIds: consents.missing },
      });
    }

    const [first] = await previewSeries(
      context.db,
      practice,
      {
        startsAt: input.startsAt,
        intervalWeeks: input.intervalWeeks,
        count: 1,
        minutes: service.minutes,
      },
      { checkGoogle: !staff },
    );
    if (first?.status !== "free") throw errors.SLOT_UNAVAILABLE();

    await releaseExpiredHolds(context.db, practice.id);
    const price = practice.payAtVisit ? 0 : service.credits;
    const template = {
      note: input.note ?? null,
      answers: questionnaire.answers,
      clientTimezone: forOther ? null : (input.timezone ?? null),
    };
    let created: { standing: typeof StandingTime.$inferSelect; id: string };
    try {
      created = await context.db.transaction(async (tx) => {
        if (
          price > 0 &&
          (await adjustCredits(tx, member.id, -price)) === undefined
        ) {
          throw errors.NO_CREDITS();
        }
        const [standing] = await tx
          .insert(StandingTime)
          .values({
            practiceId: practice.id,
            memberId: member.id,
            serviceId: service.id,
            startsAt: first.startsAt,
            intervalWeeks: input.intervalWeeks,
            createdById: userId,
          })
          .returning();
        if (!standing) throw new Error("Failed to insert standing time");
        const [booking] = await tx
          .insert(Booking)
          .values({
            practiceId: practice.id,
            kind: "consultation",
            serviceId: service.id,
            credits: price,
            startsAt: first.startsAt,
            endsAt: first.endsAt,
            memberId: member.id,
            ...template,
            standingId: standing.id,
            standingSlot: first.startsAt,
            createdById: userId,
          })
          .returning({ id: Booking.id });
        if (!booking) throw new Error("Failed to insert booking");
        if (price > 0) {
          await tx.insert(CreditEntry).values({
            memberId: member.id,
            delta: -price,
            reason: "booking",
            bookingId: booking.id,
            note: "Постоянное время",
            createdById: userId,
          });
        }
        if (consents) {
          await recordConsents(tx, {
            practiceId: practice.id,
            memberId: member.id,
            bookingId: booking.id,
            accept: consents.accept,
            headers: context.headers,
            bySession: true,
          });
        }
        return { standing, id: booking.id };
      });
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }

    // After the commit: the next weeks, Google and mails never undo the first.
    const rest = await extendStanding(context.db, created.standing, {
      template,
    });
    await exportBooking(context.db, created.id);
    await notifySeriesBooked(context.db, [
      created.id,
      ...rest.confirmed.map((b) => b.id),
    ]);

    return {
      standingId: created.standing.id,
      dates: [
        first.startsAt,
        ...rest.confirmed.map((b) => b.startsAt),
        ...rest.held.map((b) => b.startsAt),
      ].sort((a, b) => a.getTime() - b.getTime()),
      held: rest.held.length,
    };
  });

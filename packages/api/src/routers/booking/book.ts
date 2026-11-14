import {
  and,
  Booking,
  eq,
  isExclusionViolation,
  PracticeMember,
  user,
} from "@synoro/db";
import { notifyBookingConfirmed } from "@synoro/jobs/booking-video";
import {
  bookingAnswersInput,
  clientTimeZoneInput,
  consentsInput,
} from "@synoro/validators";
import { z } from "zod";
import { ANSWERS_INVALID, bookingAnswers } from "../../lib/booking-questions";
import {
  adjustCredits,
  loadRules,
  recordCredit,
  releaseExpiredHolds,
} from "../../lib/bookings";
import {
  CONSENTS_REQUIRED,
  checkConsents,
  recordConsents,
} from "../../lib/consents";
import { exportBooking, isBusyInGoogle } from "../../lib/google-calendar";
import {
  findMembership,
  findOpenPractice,
  isStaff,
  practiceProcedure,
} from "../../lib/practice-access";
import { isScheduledSlot } from "../../lib/schedule";
import { resolveService } from "../../lib/services";

/**
 * Book a paid service — `serviceId`, the practice's first one when missing —
 * spending its price in credits (one for a plain hour) from the client's balance.
 * SERVICE_NOT_FOUND when it isn't an active service of the practice.
 *
 * A client books for themselves. Staff (owner, admin) may pass `memberId` to
 * book a client of the practice from that client's balance; a client passing
 * someone else's `memberId` gets FORBIDDEN, an unknown member NOT_FOUND.
 *
 * PHONE_REQUIRED when a client booking for themselves has no phone yet;
 * ANSWERS_INVALID when they left the practice's questionnaire («Про»)
 * unfilled — `answers` are keyed by question id, staff booking a client skip it;
 * CONSENTS_REQUIRED when a required document of the practice is neither
 * ticked (`consents`) nor accepted before — again, not asked of staff;
 * NO_CREDITS when the client's balance is zero; SLOT_UNAVAILABLE when the
 * time is off the schedule, busy in the specialist's Google Calendar (checked
 * for clients only: staff see it on the calendar, as in `bookFree`), or
 * someone else holds it (the `bookings_no_overlap` constraint decides races).
 * The credit is taken first with a conditional update and given back if the
 * insert fails.
 *
 * When the practice is paid at the visit (`payAtVisit`) staff book a client
 * without the balance (`credits` 0, nothing taken or logged), and a client
 * booking themselves gets PAY_AT_VISIT: they book with `bookAtVisit`.
 *
 * @example client.booking.book({ practiceId, startsAt: new Date("2026-11-02T07:00:00Z") })
 * @example client.booking.book({ practiceId, startsAt, memberId }) // staff
 */
export const book = practiceProcedure
  .errors({
    PHONE_REQUIRED: {
      message:
        "Укажите номер телефона в профиле — специалисту нужно связаться с вами",
    },
    NO_CREDITS: {
      message: "Баланс пуст — пополните его или обратитесь к администратору",
    },
    PAY_AT_VISIT: {
      message: "Специалист принимает оплату на приёме — обновите страницу",
    },
    SLOT_UNAVAILABLE: {
      message: "Это время недоступно для записи",
    },
    NOT_FOUND: { message: "Клиент не найден в этой практике" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
    ANSWERS_INVALID,
    CONSENTS_REQUIRED,
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      startsAt: z.date(),
      /** What to book; the practice's first service when missing. */
      serviceId: z.uuid().optional(),
      note: z.string().trim().max(500).optional(),
      /** Staff only: the client to book; defaults to the caller. */
      memberId: z.uuid().optional(),
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
    const staff = isStaff(caller.role);
    const { memberId } = input;
    const forOther = memberId !== undefined && memberId !== caller.id;
    if (forOther && !staff) throw errors.FORBIDDEN();
    if (practice.payAtVisit && !forOther) throw errors.PAY_AT_VISIT();

    const member = forOther
      ? await context.db.query.PracticeMember.findFirst({
          where: and(
            eq(PracticeMember.id, memberId),
            eq(PracticeMember.practiceId, practice.id),
            eq(PracticeMember.role, "client"),
          ),
        })
      : caller;
    if (!member) throw errors.NOT_FOUND();
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

    const rules = await loadRules(context.db, practice.id);
    const scheduled = isScheduledSlot({
      rules,
      startsAt: input.startsAt,
      timeZone: practice.timezone,
      kind: "consultation",
      minutes: service.minutes,
      now: new Date(),
    });
    if (!scheduled) throw errors.SLOT_UNAVAILABLE();
    const endsAt = new Date(
      input.startsAt.getTime() + service.minutes * 60_000,
    );
    const range = { startsAt: input.startsAt, endsAt };
    if (!staff && (await isBusyInGoogle(context.db, practice.id, range))) {
      throw errors.SLOT_UNAVAILABLE();
    }

    await releaseExpiredHolds(context.db, practice.id);
    // Paid at the visit: the balance is neither needed nor touched.
    const price = practice.payAtVisit ? 0 : service.credits;
    const credits =
      price === 0
        ? member.credits
        : await adjustCredits(context.db, member.id, -price);
    if (credits === undefined) throw errors.NO_CREDITS();

    let booking: typeof Booking.$inferSelect | undefined;
    try {
      [booking] = await context.db
        .insert(Booking)
        .values({
          practiceId: practice.id,
          kind: "consultation",
          serviceId: service.id,
          credits: price,
          startsAt: input.startsAt,
          endsAt,
          memberId: member.id,
          note: input.note,
          answers: questionnaire.answers,
          // Staff's browser says nothing about the client's zone.
          clientTimezone: forOther ? null : (input.timezone ?? null),
          createdById: userId,
        })
        .returning();
    } catch (error) {
      if (price > 0) await adjustCredits(context.db, member.id, price);
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
    if (!booking) throw new Error("Failed to insert booking");
    if (consents) {
      await recordConsents(context.db, {
        practiceId: practice.id,
        memberId: member.id,
        bookingId: booking.id,
        accept: consents.accept,
        headers: context.headers,
      });
    }

    if (price > 0) {
      await recordCredit(context.db, {
        memberId: member.id,
        delta: -price,
        reason: "booking",
        bookingId: booking.id,
        createdById: userId,
      });
    }
    await exportBooking(context.db, booking.id);
    await notifyBookingConfirmed(context.db, booking.id);

    // `credits` stays what this booking cost; `balance` is what is left.
    return { ...booking, balance: credits };
  });

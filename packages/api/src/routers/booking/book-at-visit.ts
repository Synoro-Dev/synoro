import {
  and,
  Booking,
  count,
  eq,
  gt,
  isExclusionViolation,
  or,
  PracticeMember,
  sql,
  user,
} from "@synoro/db";
import {
  markRemindersCovered,
  notifyBookingConfirmed,
} from "@synoro/jobs/booking-video";
import {
  AT_VISIT_MAX_UPCOMING,
  bookingAnswersInput,
  clientTimeZoneInput,
  consentsInput,
  guestBookingFormSchema,
} from "@synoro/validators";
import { z } from "zod";

import { ANSWERS_INVALID, bookingAnswers } from "../../lib/booking-questions";
import { loadRules, releaseExpiredHolds } from "../../lib/bookings";
import {
  CONSENTS_REQUIRED,
  checkConsents,
  recordConsents,
  sessionMemberId,
} from "../../lib/consents";
import { exportBooking, isBusyInGoogle } from "../../lib/google-calendar";
import {
  findOrCreateGuestMember,
  hashGuestToken,
  newGuestToken,
  sendBookingLink,
} from "../../lib/guests";
import {
  findMembership,
  findOpenPractice,
  isStaff,
} from "../../lib/practice-access";
import {
  clientIp,
  rateLimitKeyPart,
  withinRateLimit,
} from "../../lib/rate-limit";
import { isScheduledSlot } from "../../lib/schedule";
import { resolveService } from "../../lib/services";
import { publicProcedure } from "../../orpc";

/** Requests from one address: a person books a visit or two, not ten in ten minutes. */
const PER_IP = { limit: 10, windowSeconds: 10 * 60 };

/** Booking mails to one email (any practice) an hour: nobody gets flooded. */
const PER_EMAIL = { limit: 3, windowSeconds: 60 * 60 };

/**
 * Book a service yourself on the booking page when the specialist is paid at
 * the visit (`practices.pay_at_visit`): no payment and no balance — the
 * booking is confirmed at once with `credits = 0` — `serviceId`, the
 * practice's first service when missing (SERVICE_NOT_FOUND when it isn't an
 * active one).
 *
 * Who books, as in `bookIntro`: a visitor leaves `guest` (name, phone, email)
 * and becomes a passive client; a signed-in client books as themselves
 * (PHONE_REQUIRED without a phone) and joins the practice if not in it yet.
 * Either way they get `/b/<token>` by email (`token` is returned too) to see
 * or cancel it — until it starts — without signing in.
 *
 * Nothing is paid, so typed contacts are the only brake: TOO_MANY when the
 * client, or anyone with the same phone, already has `AT_VISIT_MAX_UPCOMING`
 * upcoming such bookings here (checked under a per-practice lock), and
 * RATE_LIMITED past 10 requests in ten minutes from one address or 3 mails
 * an hour to one email.
 *
 * @example client.booking.bookAtVisit({ practiceId, serviceId, startsAt, guest: { name: "Иван", phone: "+7 900 000-00-00", email: "ivan@example.com" } })
 */
export const bookAtVisit = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика не найдена — обновите страницу" },
    PAY_AT_VISIT_OFF: {
      message:
        "Специалист не принимает онлайн-запись без оплаты — обновите страницу",
    },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
    SLOT_UNAVAILABLE: { message: "Это время недоступно для записи" },
    CONTACTS_REQUIRED: { message: "Укажите имя, телефон и почту" },
    PHONE_REQUIRED: {
      message:
        "Укажите номер телефона в профиле — специалисту нужно связаться с вами",
    },
    SIGN_IN_REQUIRED: {
      message: "Эта почта принадлежит специалисту практики — войдите в аккаунт",
    },
    STAFF: {
      message: "Это ваша практика — клиентов записывают в календаре",
    },
    TOO_MANY: {
      message:
        "У вас уже три предстоящие записи к этому специалисту. Чтобы записаться ещё, отмените одну из них или свяжитесь со специалистом",
    },
    RATE_LIMITED: {
      message: "Слишком много попыток — попробуйте чуть позже",
    },
    ANSWERS_INVALID,
    CONSENTS_REQUIRED,
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      startsAt: z.date(),
      /** What to book; the practice's first service when missing. */
      serviceId: z.uuid().optional(),
      /** Who books, when not signed in. Ignored for a signed-in client. */
      guest: guestBookingFormSchema.omit({ note: true }).optional(),
      note: z.string().trim().max(500).optional(),
      answers: bookingAnswersInput,
      /** The practice's documents the client ticked (`consentsInput`). */
      consents: consentsInput,
      /** The client's browser zone: the mails write the time in it. */
      timezone: clientTimeZoneInput,
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const ip = clientIp(context.headers);
    if (
      ip &&
      !(await withinRateLimit(context.db, {
        key: `book-at-visit:ip:${ip}`,
        ...PER_IP,
      }))
    ) {
      throw errors.RATE_LIMITED();
    }

    const practice = await findOpenPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    if (!practice.payAtVisit) throw errors.PAY_AT_VISIT_OFF();
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
      await sessionMemberId(context.db, practice.id, context.session),
      input.consents,
    );
    if (consents.missing.length > 0) {
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
    if (
      await isBusyInGoogle(context.db, practice.id, {
        startsAt: input.startsAt,
        endsAt,
      })
    ) {
      throw errors.SLOT_UNAVAILABLE();
    }

    // Who books: the signed-in client, else the visitor from the form.
    let person: {
      userId: string;
      email: string;
      memberId: string;
      name: string;
      phone: string;
    };
    const session = context.session;
    if (session) {
      const account = await context.db.query.user.findFirst({
        where: eq(user.id, session.user.id),
        columns: { id: true, name: true, email: true, phone: true },
      });
      if (!account) throw errors.NOT_FOUND();
      let member = await findMembership(context.db, practice.id, account.id);
      if (member && isStaff(member.role)) throw errors.STAFF();
      if (!account.phone) throw errors.PHONE_REQUIRED();
      if (!member) {
        await context.db
          .insert(PracticeMember)
          .values({ practiceId: practice.id, userId: account.id })
          .onConflictDoNothing();
        member = await findMembership(context.db, practice.id, account.id);
      }
      if (!member) throw new Error("Failed to create the client membership");
      person = {
        userId: account.id,
        email: account.email,
        memberId: member.id,
        name: account.name,
        phone: account.phone,
      };
    } else {
      if (!input.guest) throw errors.CONTACTS_REQUIRED();
      const guest = await findOrCreateGuestMember(
        context.db,
        practice.id,
        input.guest,
      );
      if (guest.staff) throw errors.SIGN_IN_REQUIRED();
      person = {
        userId: guest.user.id,
        email: guest.user.email,
        memberId: guest.memberId,
        name: input.guest.name,
        phone: input.guest.phone,
      };
    }

    await releaseExpiredHolds(context.db, practice.id);

    const token = newGuestToken();
    let booking: typeof Booking.$inferSelect | undefined;
    try {
      booking = await context.db.transaction(async (tx) => {
        // Serialise these bookings of the practice: the count below and the
        // insert must not interleave with another tab of the same person.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`at-visit:${practice.id}`}))`,
        );
        const [upcoming] = await tx
          .select({ n: count() })
          .from(Booking)
          .where(
            and(
              eq(Booking.practiceId, practice.id),
              eq(Booking.kind, "consultation"),
              eq(Booking.credits, 0),
              eq(Booking.status, "active"),
              gt(Booking.startsAt, new Date()),
              or(
                eq(Booking.memberId, person.memberId),
                eq(Booking.guestPhone, person.phone),
              ),
            ),
          );
        if ((upcoming?.n ?? 0) >= AT_VISIT_MAX_UPCOMING) {
          throw errors.TOO_MANY();
        }
        // One mail goes out per booking: limit them per address mailed. In
        // the transaction, so an attempt that books nothing (the time taken
        // meanwhile) gives the hit back.
        if (
          !(await withinRateLimit(tx, {
            key: `book-at-visit:email:${rateLimitKeyPart(person.email)}`,
            ...PER_EMAIL,
          }))
        ) {
          throw errors.RATE_LIMITED();
        }

        const [row] = await tx
          .insert(Booking)
          .values({
            practiceId: practice.id,
            kind: "consultation",
            serviceId: service.id,
            credits: 0,
            startsAt: input.startsAt,
            endsAt,
            memberId: person.memberId,
            guestName: person.name,
            guestPhone: person.phone,
            note: input.note || null,
            answers: questionnaire.answers,
            clientTimezone: input.timezone ?? null,
            accessTokenHash: hashGuestToken(token),
            createdById: person.userId,
          })
          .returning();
        return row;
      });
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
    if (!booking) throw new Error("Failed to insert booking");
    await recordConsents(context.db, {
      practiceId: practice.id,
      memberId: person.memberId,
      bookingId: booking.id,
      accept: consents.accept,
      headers: context.headers,
    });

    await exportBooking(context.db, booking.id);
    // Staff hear about it; the client's mail is the link below, with the
    // video room, instead of the usual confirmation.
    await notifyBookingConfirmed(context.db, booking.id, undefined, {
      client: false,
    });
    const mailed = await sendBookingLink({
      email: person.email,
      name: person.name,
      practiceName: practice.name,
      timeZone: input.timezone ?? practice.timezone,
      startsAt: booking.startsAt,
      holdUntil: null,
      atVisit: true,
      videoUrl: practice.videoUrl,
      token,
    });
    // That mail covers the reminders already due; without it they still go.
    if (mailed) await markRemindersCovered(context.db, booking.id);

    return { token, startsAt: booking.startsAt, endsAt: booking.endsAt };
  });

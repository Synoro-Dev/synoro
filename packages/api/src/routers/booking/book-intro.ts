import {
  and,
  Booking,
  eq,
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
  bookingAnswersInput,
  clientTimeZoneInput,
  consentsInput,
  guestBookingFormSchema,
  professionTerms,
} from "@synoro/validators";
import { z } from "zod";

import { track } from "../../lib/analytics";
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
import { isScheduledSlot } from "../../lib/schedule";
import { publicProcedure } from "../../orpc";

/**
 * Book the free intro (30 minutes, `kind = 'free'`) yourself on the booking
 * page, when the owner allows it (`practices.free_booking_enabled`). No
 * payment: the booking is confirmed at once.
 *
 * A visitor leaves `guest` (name, phone, email) and becomes a passive client,
 * as in `reserve`; a signed-in client books as themselves (PHONE_REQUIRED
 * without a phone on the profile) and joins the practice if not in it yet.
 * Either way they get `/b/<token>` by email (`token` is returned too) to see
 * or cancel it without signing in.
 *
 * One intro per person and practice: ALREADY_USED when the client, or anyone
 * with the same phone, has an intro booked or had one (a no-show counts;
 * a cancelled one doesn't). Checked under a per-practice lock, so two tabs
 * can't book two.
 *
 * @example client.booking.bookIntro({ practiceId, startsAt, guest: { name: "Иван", phone: "+7 900 000-00-00", email: "ivan@example.com" } })
 */
export const bookIntro = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика не найдена — обновите страницу" },
    FREE_BOOKING_OFF: {
      message: "Специалист не принимает бесплатную запись онлайн",
    },
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
      message: "Это ваша практика — гостей записывают в календаре",
    },
    ALREADY_USED: {
      message:
        "Вы уже записывались на бесплатную встречу у этого специалиста — выберите платную запись",
    },
    ANSWERS_INVALID,
    CONSENTS_REQUIRED,
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      startsAt: z.date(),
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
    const practice = await findOpenPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    if (!practice.freeBookingEnabled) throw errors.FREE_BOOKING_OFF();

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
      kind: "free",
      introMinutes: practice.introMinutes,
      now: new Date(),
    });
    if (!scheduled) throw errors.SLOT_UNAVAILABLE();
    const endsAt = new Date(
      input.startsAt.getTime() + practice.introMinutes * 60_000,
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
        // Serialise intros of the practice: the check below and the insert
        // must not interleave with another tab of the same person.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`free-intro:${practice.id}`}))`,
        );
        const [used] = await tx
          .select({ id: Booking.id })
          .from(Booking)
          .where(
            and(
              eq(Booking.practiceId, practice.id),
              eq(Booking.kind, "free"),
              or(
                eq(Booking.memberId, person.memberId),
                eq(Booking.guestPhone, person.phone),
              ),
              or(
                eq(Booking.status, "active"),
                eq(Booking.cancelReason, "no_show"),
              ),
            ),
          )
          .limit(1);
        if (used) throw errors.ALREADY_USED();

        const [row] = await tx
          .insert(Booking)
          .values({
            practiceId: practice.id,
            kind: "free",
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
        // In the booking's transaction: a failure here leaves no booking.
        if (row) {
          await recordConsents(tx, {
            practiceId: practice.id,
            memberId: person.memberId,
            bookingId: row.id,
            accept: consents.accept,
            headers: context.headers,
            bySession: context.session !== null,
          });
        }
        return row;
      });
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
    if (!booking) throw new Error("Failed to insert booking");

    await exportBooking(context.db, booking.id);
    // Staff hear about it; the client's mail is the link below, with the
    // video room — the booking has none of its own yet.
    await notifyBookingConfirmed(context.db, booking.id);
    const mailed = await sendBookingLink({
      email: person.email,
      name: person.name,
      practiceName: practice.name,
      timeZone: input.timezone ?? practice.timezone,
      startsAt: booking.startsAt,
      holdUntil: null,
      intro: professionTerms(practice.profession).free,
      videoUrl: practice.videoUrl,
      token,
    });
    // That mail covers the reminders already due; without it they still go.
    if (mailed) await markRemindersCovered(context.db, booking.id);
    track("intro_booked", person.userId, {
      bookingId: booking.id,
      practiceId: practice.id,
      signedIn: session !== null,
    });

    return { token, startsAt: booking.startsAt, endsAt: booking.endsAt };
  });

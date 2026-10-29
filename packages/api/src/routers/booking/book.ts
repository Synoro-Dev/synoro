import {
  and,
  Booking,
  eq,
  isExclusionViolation,
  PracticeMember,
  user,
} from "@synoro/db";
import { notifyBookingConfirmed } from "@synoro/jobs/booking-video";
import { z } from "zod";

import {
  adjustCredits,
  loadRules,
  recordCredit,
  releaseExpiredHolds,
} from "../../lib/bookings";
import { exportBooking, isBusyInGoogle } from "../../lib/google-calendar";
import {
  findMembership,
  findPractice,
  isStaff,
  practiceProcedure,
} from "../../lib/practice-access";
import { isScheduledSlot, SLOT_MINUTES } from "../../lib/schedule";

/**
 * Book a one-hour paid consultation, spending one credit of the client.
 *
 * A client books for themselves. Staff (owner, admin) may pass `memberId` to
 * book a client of the practice from that client's balance; a client passing
 * someone else's `memberId` gets FORBIDDEN, an unknown member NOT_FOUND.
 *
 * PHONE_REQUIRED when a client booking for themselves has no phone yet;
 * NO_CREDITS when the client's balance is zero; SLOT_UNAVAILABLE when the
 * time is off the schedule, busy in the specialist's Google Calendar (checked
 * for clients only: staff see it on the calendar, as in `bookFree`), or
 * someone else holds it (the `bookings_no_overlap` constraint decides races).
 * The credit is taken first with a conditional update and given back if the
 * insert fails.
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
    SLOT_UNAVAILABLE: {
      message: "Это время недоступно для записи",
    },
    NOT_FOUND: { message: "Клиент не найден в этой практике" },
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      startsAt: z.date(),
      note: z.string().trim().max(500).optional(),
      /** Staff only: the client to book; defaults to the caller. */
      memberId: z.uuid().optional(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const [caller, practice] = await Promise.all([
      findMembership(context.db, input.practiceId, userId),
      findPractice(context.db, input.practiceId),
    ]);
    if (!caller || !practice) throw errors.FORBIDDEN();
    const staff = isStaff(caller.role);
    const { memberId } = input;
    const forOther = memberId !== undefined && memberId !== caller.id;
    if (forOther && !staff) throw errors.FORBIDDEN();

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
    // Staff booking a client reach them anyway; a client must leave a phone.
    if (!forOther) {
      const account = await context.db.query.user.findFirst({
        where: eq(user.id, userId),
        columns: { phone: true },
      });
      if (!account?.phone) throw errors.PHONE_REQUIRED();
    }

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
    if (!staff && (await isBusyInGoogle(context.db, practice.id, range))) {
      throw errors.SLOT_UNAVAILABLE();
    }

    await releaseExpiredHolds(context.db, practice.id);
    const credits = await adjustCredits(context.db, member.id, -1);
    if (credits === undefined) throw errors.NO_CREDITS();

    let booking: typeof Booking.$inferSelect | undefined;
    try {
      [booking] = await context.db
        .insert(Booking)
        .values({
          practiceId: practice.id,
          kind: "consultation",
          startsAt: input.startsAt,
          endsAt,
          memberId: member.id,
          note: input.note,
          createdById: userId,
        })
        .returning();
    } catch (error) {
      await adjustCredits(context.db, member.id, 1);
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
    if (!booking) throw new Error("Failed to insert booking");

    await recordCredit(context.db, {
      memberId: member.id,
      delta: -1,
      reason: "booking",
      bookingId: booking.id,
      createdById: userId,
    });
    await exportBooking(context.db, booking.id);
    await notifyBookingConfirmed(context.db, booking.id);

    return { ...booking, credits };
  });

import { Booking, isExclusionViolation } from "@acme/db";
import { z } from "zod";

import { adjustCredits, loadRules, recordCredit } from "../../lib/bookings";
import {
  findMembership,
  findPractice,
  practiceProcedure,
} from "../../lib/practice-access";
import { isScheduledSlot, SLOT_MINUTES } from "../../lib/schedule";

/**
 * Book a one-hour paid consultation for the caller, spending one credit.
 *
 * NO_CREDITS when the balance is zero; SLOT_UNAVAILABLE when the time is off
 * the schedule or someone else holds it (the `bookings_no_overlap`
 * constraint decides races). The credit is taken first with a conditional
 * update and given back if the insert fails — there are no interactive
 * transactions on the Neon HTTP driver.
 *
 * @example client.booking.book({ practiceId, startsAt: new Date("2026-11-02T07:00:00Z") })
 */
export const book = practiceProcedure
  .errors({
    NO_CREDITS: {
      message: "Нет оплаченных консультаций — обратитесь к администратору",
    },
    SLOT_UNAVAILABLE: {
      message: "Это время недоступно для записи",
    },
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      startsAt: z.date(),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const [member, practice] = await Promise.all([
      findMembership(context.db, input.practiceId, userId),
      findPractice(context.db, input.practiceId),
    ]);
    if (!member || !practice) throw errors.FORBIDDEN();

    const rules = await loadRules(context.db, practice.id);
    const scheduled = isScheduledSlot({
      rules,
      startsAt: input.startsAt,
      timeZone: practice.timezone,
      kind: "consultation",
      now: new Date(),
    });
    if (!scheduled) throw errors.SLOT_UNAVAILABLE();

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
          endsAt: new Date(
            input.startsAt.getTime() + SLOT_MINUTES.consultation * 60_000,
          ),
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

    return { ...booking, credits };
  });

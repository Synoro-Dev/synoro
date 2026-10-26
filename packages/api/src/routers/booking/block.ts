import { Booking, isExclusionViolation } from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { isOnHalfHourGrid } from "../../lib/schedule";

const MAX_BLOCK_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * Close a time range for clients (the specialist's own time) — staff only.
 * Any half-hour aligned range up to 31 days, inside or outside working
 * hours. Fails with SLOT_UNAVAILABLE if bookings already sit in the range:
 * cancel them first.
 *
 * @example client.booking.block({ practiceId, startsAt, endsAt, note: "Отпуск" })
 */
export const block = practiceProcedure
  .errors({
    SLOT_UNAVAILABLE: {
      message: "На это время уже есть записи — сначала отмените их",
    },
  })
  .input(
    z
      .object({
        practiceId: z.uuid(),
        startsAt: z.date(),
        endsAt: z.date(),
        note: z.string().trim().max(500).optional(),
      })
      .refine((i) => i.startsAt < i.endsAt, {
        message: "Конец должен быть позже начала",
        path: ["endsAt"],
      })
      .refine(
        (i) => isOnHalfHourGrid(i.startsAt) && isOnHalfHourGrid(i.endsAt),
        {
          message: "Время должно быть кратно 30 минутам",
          path: ["startsAt"],
        },
      )
      .refine(
        (i) => i.endsAt.getTime() - i.startsAt.getTime() <= MAX_BLOCK_MS,
        {
          message: "Не больше 31 дня за раз",
          path: ["endsAt"],
        },
      ),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      userId,
    );
    if (!staff) throw errors.FORBIDDEN();

    try {
      const [booking] = await context.db
        .insert(Booking)
        .values({
          practiceId: input.practiceId,
          kind: "blocked",
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          note: input.note || null,
          createdById: userId,
        })
        .returning();
      if (!booking) throw new Error("Failed to insert block");
      return booking;
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ cause: error });
      }
      throw error;
    }
  });

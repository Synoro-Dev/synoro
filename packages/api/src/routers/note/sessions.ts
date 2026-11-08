import {
  and,
  Booking,
  desc,
  eq,
  isNull,
  lte,
  ne,
  notInArray,
  or,
} from "@synoro/db";
import { z } from "zod";

import { noteProcedure, ownsPractice } from "./owner";

/** Older sessions are rare to write about; the list stays short. */
const SESSIONS_LIMIT = 200;

/**
 * The client's sessions a note can be about: every booking of theirs that has
 * begun, newest first, however long ago — no-shows and cancellations too, but
 * not unpaid holds that never became a booking. Owner only.
 *
 * @example client.note.sessions({ practiceId, memberId })
 */
export const sessions = noteProcedure
  .input(z.object({ practiceId: z.uuid(), memberId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    if (
      !(await ownsPractice(
        context.db,
        input.practiceId,
        context.session.user.id,
      ))
    ) {
      throw errors.FORBIDDEN();
    }
    return context.db
      .select({
        id: Booking.id,
        startsAt: Booking.startsAt,
        status: Booking.status,
        cancelReason: Booking.cancelReason,
      })
      .from(Booking)
      .where(
        and(
          eq(Booking.practiceId, input.practiceId),
          eq(Booking.memberId, input.memberId),
          ne(Booking.kind, "blocked"),
          lte(Booking.startsAt, new Date()),
          isNull(Booking.holdUntil),
          or(
            isNull(Booking.cancelReason),
            notInArray(Booking.cancelReason, [
              "hold_expired",
              "payment_cancelled",
            ]),
          ),
        ),
      )
      .orderBy(desc(Booking.startsAt), desc(Booking.id))
      .limit(SESSIONS_LIMIT);
  });

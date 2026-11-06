import { and, eq, WaitlistEntry } from "@synoro/db";
import { z } from "zod";

import { findMembership, isStaff } from "../../lib/practice-access";
import { protectedProcedure } from "../../orpc";

/**
 * Take a wish off the waiting list: its owner leaves it, the practice's staff
 * remove it (the person has been called, or booked by phone).
 *
 * @example client.waitlist.leave({ entryId })
 */
export const leave = protectedProcedure
  .errors({ NOT_FOUND: { message: "Запись в листе ожидания не найдена" } })
  .input(z.object({ entryId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const entry = await context.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.id, input.entryId),
      columns: { id: true, userId: true, practiceId: true },
    });
    if (!entry) throw errors.NOT_FOUND();

    if (entry.userId !== userId) {
      const caller = await findMembership(context.db, entry.practiceId, userId);
      if (!caller || !isStaff(caller.role)) throw errors.NOT_FOUND();
    }
    await context.db
      .delete(WaitlistEntry)
      .where(and(eq(WaitlistEntry.id, entry.id)));
    return { id: entry.id };
  });

import { and, asc, eq, gte, isNull, Service, WaitlistEntry } from "@synoro/db";
import { z } from "zod";

import { findPractice } from "../../lib/practice-access";
import { toZonedDate } from "../../lib/schedule";
import { protectedProcedure } from "../../orpc";

/**
 * The caller's own open wishes at a practice — not yet told of anything and
 * not over — so the booking page can say «вы в листе ожидания» and let them
 * leave it.
 *
 * @example client.waitlist.mine({ practiceId })
 */
export const mine = protectedProcedure
  .errors({ NOT_FOUND: { message: "Практика не найдена" } })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const practice = await findPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    const today = toZonedDate(new Date(), practice.timezone);

    const entries = await context.db
      .select({
        id: WaitlistEntry.id,
        fromDate: WaitlistEntry.fromDate,
        toDate: WaitlistEntry.toDate,
        fromMinute: WaitlistEntry.fromMinute,
        toMinute: WaitlistEntry.toMinute,
        service: Service.name,
      })
      .from(WaitlistEntry)
      .leftJoin(Service, eq(Service.id, WaitlistEntry.serviceId))
      .where(
        and(
          eq(WaitlistEntry.practiceId, practice.id),
          eq(WaitlistEntry.userId, context.session.user.id),
          isNull(WaitlistEntry.notifiedAt),
          gte(WaitlistEntry.toDate, today),
        ),
      )
      .orderBy(asc(WaitlistEntry.createdAt));
    return { entries };
  });

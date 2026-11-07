import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  Service,
  user,
  WaitlistEntry,
} from "@synoro/db";
import { z } from "zod";

import {
  findPractice,
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { toZonedDate } from "../../lib/schedule";

/**
 * Who waits for time at the practice: open wishes, oldest first, with how to
 * reach the person — for staff to call them when time frees up, or to take a
 * wish off once it is settled. Staff only.
 *
 * @example client.waitlist.list({ practiceId })
 */
export const list = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const [staff, practice] = await Promise.all([
      findStaffMembership(
        context.db,
        input.practiceId,
        context.session.user.id,
      ),
      findPractice(context.db, input.practiceId),
    ]);
    if (!staff || !practice) throw errors.FORBIDDEN();
    const today = toZonedDate(new Date(), practice.timezone);

    const entries = await context.db
      .select({
        id: WaitlistEntry.id,
        fromDate: WaitlistEntry.fromDate,
        toDate: WaitlistEntry.toDate,
        fromMinute: WaitlistEntry.fromMinute,
        toMinute: WaitlistEntry.toMinute,
        createdAt: WaitlistEntry.createdAt,
        service: Service.name,
        name: user.name,
        phone: user.phone,
        email: user.email,
      })
      .from(WaitlistEntry)
      .innerJoin(user, eq(user.id, WaitlistEntry.userId))
      .leftJoin(Service, eq(Service.id, WaitlistEntry.serviceId))
      .where(
        and(
          eq(WaitlistEntry.practiceId, practice.id),
          isNotNull(WaitlistEntry.confirmedAt),
          isNull(WaitlistEntry.notifiedAt),
          gte(WaitlistEntry.toDate, today),
        ),
      )
      .orderBy(asc(WaitlistEntry.createdAt));
    return { timezone: practice.timezone, entries };
  });

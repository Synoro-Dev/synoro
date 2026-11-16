import { eq, StandingTime } from "@synoro/db";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findMembership,
  findOpenPractice,
  isStaff,
} from "../../lib/practice-access";
import { extendStanding, settleStandingHolds } from "../../lib/standing";
import { protectedProcedure } from "../../orpc";

/**
 * Resume a paused standing time (a hold ran out unpaid): its next dates are
 * made again from the balance — confirmed as far as the balance goes, held
 * for the rest, with the payment link. The client or staff may; PRO_REQUIRED
 * when the owner's «Про» has run out.
 *
 * @example client.standing.resume({ standingId })
 */
export const resume = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Постоянное время не найдено" },
    NOT_PAUSED: { message: "Постоянное время не на паузе" },
    PRO_REQUIRED: {
      message: "Постоянное время доступно на тарифе «Про»",
    },
  })
  .input(z.object({ standingId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const standing = await context.db.query.StandingTime.findFirst({
      where: eq(StandingTime.id, input.standingId),
    });
    if (!standing || standing.endedAt) throw errors.NOT_FOUND();
    const caller = await findMembership(
      context.db,
      standing.practiceId,
      context.session.user.id,
    );
    const own = caller !== undefined && standing.memberId === caller.id;
    if (!caller || (!own && !isStaff(caller.role))) throw errors.NOT_FOUND();
    const practice = await findOpenPractice(context.db, standing.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    if (!(await hasPro(context.db, practice.ownerId))) {
      throw errors.PRO_REQUIRED();
    }
    if (!standing.pausedAt) throw errors.NOT_PAUSED();

    const [resumed] = await context.db
      .update(StandingTime)
      .set({ pausedAt: null })
      .where(eq(StandingTime.id, standing.id))
      .returning();
    if (!resumed) throw errors.NOT_FOUND();
    await settleStandingHolds(context.db, resumed.memberId);
    const made = await extendStanding(context.db, resumed);
    return { confirmed: made.confirmed.length, held: made.held.length };
  });

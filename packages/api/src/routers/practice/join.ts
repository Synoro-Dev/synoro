import { PracticeMember } from "@synoro/db";
import { z } from "zod";

import { findMembership, findPractice } from "../../lib/practice-access";
import { protectedProcedure } from "../../orpc";

/**
 * Become a client of a practice (from its public booking page). Idempotent:
 * an existing membership is returned unchanged. New clients start with zero
 * consultations — an administrator adds paid ones.
 *
 * @example client.practice.join({ practiceId })
 */
export const join = protectedProcedure
  .errors({ NOT_FOUND: { message: "Практика не найдена" } })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    if (!(await findPractice(context.db, input.practiceId))) {
      throw errors.NOT_FOUND();
    }

    const userId = context.session.user.id;
    await context.db
      .insert(PracticeMember)
      .values({ practiceId: input.practiceId, userId, role: "client" })
      .onConflictDoNothing();

    const member = await findMembership(context.db, input.practiceId, userId);
    if (!member) throw new Error("Failed to join practice");

    return { id: member.id, role: member.role, credits: member.credits };
  });

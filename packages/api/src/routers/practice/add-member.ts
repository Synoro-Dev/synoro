import { and, eq, PracticeMember, sql, user } from "@acme/db";
import { memberInviteFormSchema } from "@acme/validators";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Add a registered user to the practice by email — staff only; making
 * someone an administrator is reserved for the owner. An existing client
 * added as administrator is promoted; the owner's role never changes.
 *
 * @example client.practice.addMember({ practiceId, email, role: "client" })
 */
export const addMember = practiceProcedure
  .errors({
    NOT_FOUND: {
      message: "Пользователь с такой почтой ещё не зарегистрирован",
    },
  })
  .input(memberInviteFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();
    if (input.role === "admin" && staff.role !== "owner") {
      throw errors.FORBIDDEN({
        message: "Назначать администраторов может только владелец",
      });
    }

    const found = await context.db.query.user.findFirst({
      where: sql`lower(${user.email}) = ${input.email.toLowerCase()}`,
      columns: { id: true },
    });
    if (!found) throw errors.NOT_FOUND();

    await context.db
      .insert(PracticeMember)
      .values({
        practiceId: input.practiceId,
        userId: found.id,
        role: input.role,
      })
      .onConflictDoNothing();

    if (input.role === "admin") {
      await context.db
        .update(PracticeMember)
        .set({ role: "admin" })
        .where(
          and(
            eq(PracticeMember.practiceId, input.practiceId),
            eq(PracticeMember.userId, found.id),
            eq(PracticeMember.role, "client"),
          ),
        );
    }

    const [member] = await context.db
      .select()
      .from(PracticeMember)
      .where(
        and(
          eq(PracticeMember.practiceId, input.practiceId),
          eq(PracticeMember.userId, found.id),
        ),
      );
    if (!member) throw new Error("Failed to add member");

    return member;
  });

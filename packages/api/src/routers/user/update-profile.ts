import { eq, isUniqueViolation, sql, user } from "@synoro/db";
import { profileFormSchema } from "@synoro/validators";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Update profile fields: username, email, phone, bio. A changed email must be verified again.
 *
 * Throws CONFLICT (with `data.field`) when the email belongs to another user,
 * so the form can mark the field instead of showing a generic failure.
 */
export const updateProfile = protectedProcedure
  .errors({
    CONFLICT: {
      message: "Этот адрес почты уже используется",
      data: z.object({ field: z.literal("email") }),
    },
  })
  .input(profileFormSchema)
  .handler(async ({ context, input, errors }) => {
    try {
      await context.db
        .update(user)
        .set({
          username: input.username,
          email: input.email,
          phone: input.phone,
          emailVerified: sql`case when lower(${user.email}) = ${input.email.toLowerCase()} then ${user.emailVerified} else false end`,
          bio: input.bio,
          updatedAt: new Date(),
        })
        .where(eq(user.id, context.session.user.id));
    } catch (error) {
      if (isUniqueViolation(error, "users_email_unique")) {
        throw errors.CONFLICT({ data: { field: "email" }, cause: error });
      }
      throw error;
    }

    return { success: true };
  });

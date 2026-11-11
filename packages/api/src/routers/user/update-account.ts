import { eq, user } from "@synoro/db";
import { accountFormSchema } from "@synoro/validators";

import { protectedProcedure } from "../../orpc";

/**
 * Update account settings: display name.
 */
export const updateAccount = protectedProcedure
  .input(accountFormSchema)
  .handler(async ({ context, input }) => {
    await context.db
      .update(user)
      .set({
        name: input.name,
        updatedAt: new Date(),
      })
      .where(eq(user.id, context.session.user.id));

    return { success: true };
  });

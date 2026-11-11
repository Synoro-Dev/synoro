import { eq, user } from "@synoro/db";
import { phoneSchema } from "@synoro/validators";
import { z } from "zod";
import { protectedProcedure } from "../../orpc";

/**
 * Set the caller's phone number — the one thing a visitor's cabinet and the
 * booking page ask for when it is missing (accounts opened by an emailed code
 * have none). The specialist uses it to reach the client.
 *
 * @example client.user.updatePhone({ phone: "8 900 123-45-67" })
 */
export const updatePhone = protectedProcedure
  .input(z.object({ phone: phoneSchema }))
  .handler(async ({ context, input }) => {
    await context.db
      .update(user)
      .set({ phone: input.phone, updatedAt: new Date() })
      .where(eq(user.id, context.session.user.id));

    return { phone: input.phone };
  });

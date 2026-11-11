import { eq, Practice } from "@synoro/db";
import { bookingThemeSchema, isDefaultBookingTheme } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findMembership,
  isStaff,
  practiceProcedure,
} from "../../lib/practice-access";
import { THEME_STAFF_ONLY } from "./theme";

/**
 * Save how the booking page looks — «Про» of the practice's owner, though
 * anyone may go back to the default look. Owner and administrators.
 *
 * @example client.practice.setTheme({ practiceId, theme: { accent: "emerald", font: "literata", radius: "round", backdrop: "tint", about: "Психолог, КПТ" } })
 */
export const setTheme = practiceProcedure
  .errors({
    FORBIDDEN: { message: THEME_STAFF_ONLY },
    PLAN_REQUIRED: {
      message: "Доступно на тарифе «Про» — оплатите его в настройках",
    },
  })
  .input(z.object({ practiceId: z.uuid(), theme: bookingThemeSchema }))
  .handler(async ({ context, input, errors }) => {
    const member = await findMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    const practice =
      member &&
      isStaff(member.role) &&
      (await context.db.query.Practice.findFirst({
        where: eq(Practice.id, input.practiceId),
        columns: { ownerId: true },
      }));
    if (!practice) throw errors.FORBIDDEN();
    if (
      !isDefaultBookingTheme(input.theme) &&
      !(await hasPro(context.db, practice.ownerId))
    ) {
      throw errors.PLAN_REQUIRED();
    }

    await context.db
      .update(Practice)
      .set({ bookingTheme: input.theme })
      .where(eq(Practice.id, input.practiceId));
    return { theme: input.theme };
  });

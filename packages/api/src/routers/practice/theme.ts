import { eq, Practice } from "@synoro/db";
import { readBookingTheme } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findMembership,
  isStaff,
  practiceProcedure,
} from "../../lib/practice-access";

/** Owner and administrators design the page; clients only see it. */
export const THEME_STAFF_ONLY =
  "Оформление страницы записи меняют владелец и администраторы";

/**
 * How the booking page looks, as saved, and whether it is shown: a theme is
 * kept while the owner is on the free plan but the page looks default.
 * Owner and administrators.
 *
 * @example client.practice.theme({ practiceId })
 */
export const theme = practiceProcedure
  .errors({ FORBIDDEN: { message: THEME_STAFF_ONLY } })
  .input(z.object({ practiceId: z.uuid() }))
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
        columns: { ownerId: true, bookingTheme: true },
      }));
    if (!practice) throw errors.FORBIDDEN();

    return {
      theme: readBookingTheme(practice.bookingTheme),
      /** The owner's plan: «Про» is what shows the theme. */
      pro: await hasPro(context.db, practice.ownerId),
    };
  });

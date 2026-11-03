import { eq, Practice } from "@synoro/db";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Which notices the practice sends — owner only, on any plan
 * (docs/reminders.md): `remindClients` — reminders 24 h and 1 h ahead;
 * `notifyStaff` — owner and administrators hear of bookings made and
 * cancelled; `dailyAgenda` — they get tomorrow's bookings at 20:00. Any of
 * them may be left out. Confirmations and cancellations always reach the
 * client.
 *
 * @example client.practice.setNotifications({ practiceId, dailyAgenda: false })
 */
export const setNotifications = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Уведомления настраивает владелец практики" },
  })
  .input(
    z.object({
      practiceId: z.uuid(),
      remindClients: z.boolean().optional(),
      notifyStaff: z.boolean().optional(),
      dailyAgenda: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const [practice] = await context.db
      .update(Practice)
      .set({
        remindClients: input.remindClients,
        notifyStaff: input.notifyStaff,
        dailyAgenda: input.dailyAgenda,
      })
      .where(eq(Practice.id, owner.practiceId))
      .returning({
        remindClients: Practice.remindClients,
        notifyStaff: Practice.notifyStaff,
        dailyAgenda: Practice.dailyAgenda,
      });
    if (!practice) throw errors.FORBIDDEN();
    return practice;
  });

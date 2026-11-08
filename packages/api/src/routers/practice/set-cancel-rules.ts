import { eq, Practice } from "@synoro/db";
import { cancelRulesSchema } from "@synoro/validators";
import { z } from "zod";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * How clients cancel on their own — owner only. `cancelHours`: up to how
 * many hours before the start a paid booking is cancelled or moved with the
 * credit back (`CANCEL_HOURS`). `lateCancel`: after that the client may still
 * cancel, without the credit back; off — only staff. Applies to bookings
 * already made too: the rule is read when the client cancels.
 *
 * @example client.practice.setCancelRules({ practiceId, cancelHours: 12, lateCancel: true })
 */
export const setCancelRules = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Правила отмены настраивает владелец практики" },
  })
  .input(cancelRulesSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const [practice] = await context.db
      .update(Practice)
      .set({ cancelHours: input.cancelHours, lateCancel: input.lateCancel })
      .where(eq(Practice.id, owner.practiceId))
      .returning({
        cancelHours: Practice.cancelHours,
        lateCancel: Practice.lateCancel,
      });
    if (!practice) throw errors.FORBIDDEN();
    return practice;
  });

import { z } from "zod";

import { disconnectGoogle } from "../../lib/google-calendar";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Unlink Google Calendar and withdraw the app's access. Events already
 * written stay in the calendar. Owner only.
 *
 * @example client.googleCalendar.disconnect({ practiceId })
 */
export const disconnect = ownerProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    await disconnectGoogle(context.db, input.practiceId);
    return { ok: true };
  });

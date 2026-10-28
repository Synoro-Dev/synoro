import { z } from "zod";

import {
  connectionInfo,
  findConnection,
  googleCalendarAvailable,
} from "../../lib/google-calendar";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Whether the practice's Google Calendar is linked, to which account and
 * which calendars — staff; only the owner (`canManage`) changes it.
 *
 * @example client.googleCalendar.settings({ practiceId })
 */
export const settings = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    return {
      available: googleCalendarAvailable(),
      canManage: staff.role === "owner",
      connection: connectionInfo(
        await findConnection(context.db, input.practiceId),
      ),
    };
  });

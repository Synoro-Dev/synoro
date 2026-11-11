import { z } from "zod";

import {
  findConnection,
  GoogleError,
  listCalendars,
  withGoogle,
} from "../../lib/google-calendar";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Calendars of the linked Google account, to choose which ones close time
 * and which one gets the bookings. Owner only.
 *
 * @example client.googleCalendar.calendars({ practiceId })
 */
export const calendars = ownerProcedure
  .errors({
    NOT_CONNECTED: { message: "Google Календарь не подключён" },
    GOOGLE_UNAVAILABLE: {
      message: "Google Календарь не ответил — попробуйте позже",
    },
  })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();
    const connection = await findConnection(context.db, input.practiceId);
    if (!connection) throw errors.NOT_CONNECTED();

    try {
      return await withGoogle(context.db, connection, listCalendars);
    } catch (error) {
      if (!(error instanceof GoogleError)) throw error;
      throw errors.GOOGLE_UNAVAILABLE({
        message:
          error.kind === "revoked"
            ? "Доступ к Google Календарю отозван — подключите его заново"
            : undefined,
        cause: error,
      });
    }
  });

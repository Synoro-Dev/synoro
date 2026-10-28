import { eq, GoogleCalendarConnection } from "@synoro/db";
import { googleCalendarFormSchema } from "@synoro/validators";
import { z } from "zod";

import { connectionInfo, findConnection } from "../../lib/google-calendar";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Choose the calendars whose busy time closes booking slots, the calendar
 * bookings are written to, and whether they are written at all. Owner only.
 * Bookings already written stay where they are.
 *
 * @example client.googleCalendar.update({ practiceId, busyCalendarIds: ["primary"], eventsCalendarId: "primary", exportBookings: true })
 */
export const update = ownerProcedure
  .errors({ NOT_CONNECTED: { message: "Google Календарь не подключён" } })
  .input(googleCalendarFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();
    const connection = await findConnection(context.db, input.practiceId);
    if (!connection) throw errors.NOT_CONNECTED();

    const [updated] = await context.db
      .update(GoogleCalendarConnection)
      .set({
        busyCalendarIds: input.busyCalendarIds,
        eventsCalendarId: input.eventsCalendarId,
        exportBookings: input.exportBookings,
      })
      .where(eq(GoogleCalendarConnection.id, connection.id))
      .returning();
    return connectionInfo(updated);
  });

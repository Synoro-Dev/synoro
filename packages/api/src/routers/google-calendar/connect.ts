import { z } from "zod";

import {
  authorizationUrl,
  connectState,
  googleCalendarAvailable,
} from "../../lib/google-calendar";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * The Google consent page to send the owner to. Google returns them to
 * `/api/google-calendar/callback`, which saves the connection and lands on
 * the schedule page (see `finishGoogleConnect`).
 *
 * @example const { url } = await client.googleCalendar.connect({ practiceId }); location.href = url;
 */
export const connect = ownerProcedure
  .errors({
    UNAVAILABLE: {
      message:
        "Google Календарь не настроен на сервере (GOOGLE_CLIENT_ID, PAYMENTS_SECRET_KEY)",
    },
  })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      userId,
    );
    if (!owner) throw errors.FORBIDDEN();
    if (!googleCalendarAvailable()) throw errors.UNAVAILABLE();

    return {
      url: authorizationUrl(connectState(input.practiceId, userId)),
    };
  });

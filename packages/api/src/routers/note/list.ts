import { and, ClientNote, eq } from "@synoro/db";
import { z } from "zod";

import { noteProcedure, ownsPractice, readNotes } from "./owner";

/**
 * The owner's notes on one client, newest first, each with the session it is
 * about (`bookingStartsAt`) when it has one.
 *
 * @example client.note.list({ practiceId, memberId })
 */
export const list = noteProcedure
  .input(z.object({ practiceId: z.uuid(), memberId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    if (
      !(await ownsPractice(
        context.db,
        input.practiceId,
        context.session.user.id,
      ))
    ) {
      throw errors.FORBIDDEN();
    }
    return readNotes(
      context.db,
      and(
        eq(ClientNote.practiceId, input.practiceId),
        eq(ClientNote.memberId, input.memberId),
      ),
    );
  });

import { and, ClientNote, eq } from "@synoro/db";
import { z } from "zod";

import { noteProcedure, ownsPractice } from "./owner";

/**
 * Delete a note for good: there is no bin. Owner only.
 *
 * @example client.note.remove({ practiceId, noteId })
 */
export const remove = noteProcedure
  .input(z.object({ practiceId: z.uuid(), noteId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    if (!(await ownsPractice(db, input.practiceId, context.session.user.id))) {
      throw errors.FORBIDDEN();
    }

    const removed = await db
      .delete(ClientNote)
      .where(
        and(
          eq(ClientNote.id, input.noteId),
          eq(ClientNote.practiceId, input.practiceId),
        ),
      )
      .returning({ id: ClientNote.id });
    if (removed.length === 0) throw errors.NOT_FOUND();
    return { id: input.noteId };
  });

import { and, ClientNote, eq } from "@synoro/db";
import { clientNoteBodySchema } from "@synoro/validators";
import { z } from "zod";

import { encryptSecret } from "../../lib/secrets";
import { noteProcedure, ownsPractice, readNotes } from "./owner";

/**
 * Rewrite a note's text; the session it is about stays. Owner only.
 *
 * @example client.note.update({ practiceId, noteId, body: "…" })
 */
export const update = noteProcedure
  .input(
    z.object({
      practiceId: z.uuid(),
      noteId: z.uuid(),
      body: clientNoteBodySchema,
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    if (!(await ownsPractice(db, input.practiceId, context.session.user.id))) {
      throw errors.FORBIDDEN();
    }

    const updated = await db
      .update(ClientNote)
      .set({ body: encryptSecret(input.body) })
      .where(
        and(
          eq(ClientNote.id, input.noteId),
          eq(ClientNote.practiceId, input.practiceId),
        ),
      )
      .returning({ id: ClientNote.id });
    if (updated.length === 0) throw errors.NOT_FOUND();

    const [note] = await readNotes(db, eq(ClientNote.id, input.noteId));
    if (!note) throw errors.NOT_FOUND();
    return note;
  });

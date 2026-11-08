import { and, Booking, ClientNote, eq } from "@synoro/db";
import { clientNoteBodySchema } from "@synoro/validators";
import { z } from "zod";

import { encryptSecret } from "../../lib/secrets";
import {
  findPracticeMember,
  noteProcedure,
  ownsPractice,
  readNotes,
} from "./owner";

/**
 * A new note on a client of the practice, about one of their sessions when
 * `bookingId` is given (any status: a no-show is worth a note too). Owner
 * only.
 *
 * @example client.note.create({ practiceId, memberId, bookingId, body: "Говорили о работе" })
 */
export const create = noteProcedure
  .input(
    z.object({
      practiceId: z.uuid(),
      memberId: z.uuid(),
      bookingId: z.uuid().optional(),
      body: clientNoteBodySchema,
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    if (!(await ownsPractice(db, input.practiceId, context.session.user.id))) {
      throw errors.FORBIDDEN();
    }
    if (!(await findPracticeMember(db, input.practiceId, input.memberId))) {
      throw errors.NOT_FOUND();
    }
    if (input.bookingId) {
      const booking = await db.query.Booking.findFirst({
        where: and(
          eq(Booking.id, input.bookingId),
          eq(Booking.practiceId, input.practiceId),
          eq(Booking.memberId, input.memberId),
        ),
        columns: { id: true },
      });
      if (!booking) throw errors.NOT_FOUND();
    }

    const [row] = await db
      .insert(ClientNote)
      .values({
        practiceId: input.practiceId,
        memberId: input.memberId,
        bookingId: input.bookingId ?? null,
        body: encryptSecret(input.body),
        authorId: context.session.user.id,
      })
      .returning({ id: ClientNote.id });
    if (!row) throw new Error("Failed to insert note");

    const [note] = await readNotes(db, eq(ClientNote.id, row.id));
    if (!note) throw new Error("Note vanished");
    return note;
  });

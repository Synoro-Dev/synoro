import {
  and,
  Booking,
  ClientNote,
  type Database,
  desc,
  eq,
  PracticeMember,
  type SQL,
} from "@synoro/db";

import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { decryptSecret, secretsAvailable } from "../../lib/secrets";

/**
 * Notes are the specialist's alone: the practice's owner, in person. Not its
 * administrators, and not a Synoro admin signed in as the owner. The text is
 * stored encrypted, so without the key there are no notes at all. Handlers
 * check ownership themselves with `ownsPractice`: the practice id is input.
 */
export const noteProcedure = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Заметки видит только владелец практики" },
    NOT_FOUND: { message: "Не нашли клиента или заметку" },
    UNAVAILABLE: { message: "Заметки сейчас недоступны" },
  })
  .use(({ context, next, errors }) => {
    if (context.session.session.impersonatedBy) throw errors.FORBIDDEN();
    if (!secretsAvailable()) throw errors.UNAVAILABLE();
    return next();
  });

export async function ownsPractice(
  db: Database,
  practiceId: string,
  userId: string,
) {
  return (await findOwnerMembership(db, practiceId, userId)) !== undefined;
}

/** The member if they belong to the practice. */
export function findPracticeMember(
  db: Database,
  practiceId: string,
  memberId: string,
) {
  return db.query.PracticeMember.findFirst({
    where: and(
      eq(PracticeMember.id, memberId),
      eq(PracticeMember.practiceId, practiceId),
    ),
    columns: { id: true },
  });
}

/** Notes as the owner reads them: decrypted, newest first, with the session. */
export async function readNotes(db: Database, where: SQL | undefined) {
  const rows = await db
    .select({
      id: ClientNote.id,
      memberId: ClientNote.memberId,
      bookingId: ClientNote.bookingId,
      bookingStartsAt: Booking.startsAt,
      body: ClientNote.body,
      createdAt: ClientNote.createdAt,
      updatedAt: ClientNote.updatedAt,
    })
    .from(ClientNote)
    .leftJoin(Booking, eq(Booking.id, ClientNote.bookingId))
    .where(where)
    .orderBy(desc(ClientNote.createdAt), desc(ClientNote.id));
  return rows.map((row) => ({ ...row, body: decryptSecret(row.body) }));
}

import { createHash } from "node:crypto";

import { type Database, SentNotice, sql } from "@synoro/db";

/** One mail to the same address for the same practice and role per hour. */
const COOLDOWN = sql`interval '1 hour'`;

/** How many invitation mails one account may cause per day. */
export const MAX_INVITE_MAILS_PER_DAY = 100;

const KEY_PREFIX = "invite:";

/**
 * Whether `userId` already caused the daily maximum of invitation mails.
 * Marks live in `sent_notices` (see `SentNotice`), keyed by a hash, so an
 * address never sits in the key.
 */
export async function inviteMailsExhausted(db: Database, userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(SentNotice)
    .where(
      sql`${SentNotice.userId} = ${userId}
        and ${SentNotice.key} like ${`${KEY_PREFIX}%`}
        and ${SentNotice.sentAt} > now() - interval '1 day'`,
    );
  return (row?.n ?? 0) >= MAX_INVITE_MAILS_PER_DAY;
}

/**
 * Takes the right to mail this invitation: true once per cooldown for the
 * same practice, role and address, however many requests arrive together
 * (one `INSERT … ON CONFLICT`). A repeated invitation inside the cooldown
 * still extends the invitation, it just sends no second mail.
 */
export async function claimInviteMail(
  db: Database,
  input: { userId: string; practiceId: string; role: string; email: string },
) {
  const digest = createHash("sha256")
    .update(`${input.practiceId}:${input.role}:${input.email}`)
    .digest("hex");
  const key = `${KEY_PREFIX}${digest}`;
  const claimed = await db
    .insert(SentNotice)
    .values({ key, userId: input.userId, sentAt: sql`now()` })
    .onConflictDoUpdate({
      target: SentNotice.key,
      set: { userId: input.userId, sentAt: sql`now()` },
      setWhere: sql`${SentNotice.sentAt} < now() - ${COOLDOWN}`,
    })
    .returning({ key: SentNotice.key });
  return {
    claimed: claimed.length > 0,
    /** Gives the right back after a failed send, so a retry can mail again. */
    release: async () => {
      await db.delete(SentNotice).where(sql`${SentNotice.key} = ${key}`);
    },
  };
}

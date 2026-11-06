import { createHash } from "node:crypto";

import { type Database, SentNotice, sql } from "@synoro/db";

/** One mail to the same address for the same practice and role per hour. */
const COOLDOWN = sql`interval '1 hour'`;

/** How many invitation mails one account may cause per day. */
export const MAX_INVITE_MAILS_PER_DAY = 100;

/** The hourly mark of one invitation: practice, role and address, hashed. */
const COOLDOWN_PREFIX = "invite:";
/** One mark per mail sent, counted for the daily maximum. */
const SEND_PREFIX = "invite-send:";

/**
 * Whether `userId` already caused the daily maximum of invitation mails. Every
 * mail leaves its own mark in `sent_notices` (see `SentNotice`), so a repeat to
 * the same address counts again; no key holds an address.
 */
export async function inviteMailsExhausted(db: Database, userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(SentNotice)
    .where(
      sql`${SentNotice.userId} = ${userId}
        and ${SentNotice.key} like ${`${SEND_PREFIX}%`}
        and ${SentNotice.sentAt} > now() - interval '1 day'`,
    );
  return (row?.n ?? 0) >= MAX_INVITE_MAILS_PER_DAY;
}

/**
 * Takes the right to mail this invitation: true once per cooldown for the
 * same practice, role and address, however many requests arrive together
 * (one `INSERT … ON CONFLICT`). A repeated invitation inside the cooldown
 * still extends the invitation, it just sends no second mail. A taken right
 * also counts against the account's daily maximum.
 */
export async function claimInviteMail(
  db: Database,
  input: { userId: string; practiceId: string; role: string; email: string },
) {
  const digest = createHash("sha256")
    .update(`${input.practiceId}:${input.role}:${input.email}`)
    .digest("hex");
  const key = `${COOLDOWN_PREFIX}${digest}`;
  const claimed = await db
    .insert(SentNotice)
    .values({ key, userId: input.userId, sentAt: sql`now()` })
    .onConflictDoUpdate({
      target: SentNotice.key,
      set: { userId: input.userId, sentAt: sql`now()` },
      setWhere: sql`${SentNotice.sentAt} < now() - ${COOLDOWN}`,
    })
    .returning({ key: SentNotice.key });
  if (claimed.length === 0) {
    return { claimed: false, release: async () => {} };
  }

  const sendKey = `${SEND_PREFIX}${crypto.randomUUID()}`;
  await db
    .insert(SentNotice)
    .values({ key: sendKey, userId: input.userId, sentAt: sql`now()` });
  // Marks older than the counting window are of no use any more.
  await db.delete(SentNotice).where(
    sql`${SentNotice.userId} = ${input.userId}
        and ${SentNotice.key} like ${`${SEND_PREFIX}%`}
        and ${SentNotice.sentAt} < now() - interval '1 day'`,
  );

  return {
    claimed: true,
    /** Gives the right back after a failed send, so a retry can mail again. */
    release: async () => {
      await db
        .delete(SentNotice)
        .where(sql`${SentNotice.key} in (${key}, ${sendKey})`);
    },
  };
}

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
 * Takes the right to mail this invitation. In `sent_notices` (see
 * `SentNotice`), no key holds an address.
 *
 * - `claimed`: the mail may go. It is once per cooldown for the same
 *   practice, role and address, and it leaves a mark that counts against the
 *   account's daily maximum (a repeat after the cooldown counts again).
 * - `recent`: the same invitation was mailed within the hour; the invitation
 *   is extended, no second mail goes.
 * - `exhausted`: the account already caused the daily maximum.
 *
 * Requests of one account queue behind a transaction lock, so parallel ones
 * can neither pass the maximum nor claim one invitation twice.
 */
export async function claimInviteMail(
  db: Database,
  input: { userId: string; practiceId: string; role: string; email: string },
) {
  const digest = createHash("sha256")
    .update(`${input.practiceId}:${input.role}:${input.email}`)
    .digest("hex");
  const key = `${COOLDOWN_PREFIX}${digest}`;
  const sendKey = `${SEND_PREFIX}${crypto.randomUUID()}`;
  const sendMarks = sql`${SentNotice.userId} = ${input.userId}
    and ${SentNotice.key} like ${`${SEND_PREFIX}%`}`;

  const status = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`invite-mail:${input.userId}`}))`,
    );
    // Marks older than the counting window are of no use any more.
    await tx
      .delete(SentNotice)
      .where(
        sql`${sendMarks} and ${SentNotice.sentAt} < now() - interval '1 day'`,
      );
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(SentNotice)
      .where(sendMarks);
    if ((row?.n ?? 0) >= MAX_INVITE_MAILS_PER_DAY) return "exhausted" as const;

    const claimed = await tx
      .insert(SentNotice)
      .values({ key, userId: input.userId, sentAt: sql`now()` })
      .onConflictDoUpdate({
        target: SentNotice.key,
        set: { userId: input.userId, sentAt: sql`now()` },
        setWhere: sql`${SentNotice.sentAt} < now() - ${COOLDOWN}`,
      })
      .returning({ key: SentNotice.key });
    if (claimed.length === 0) return "recent" as const;

    await tx
      .insert(SentNotice)
      .values({ key: sendKey, userId: input.userId, sentAt: sql`now()` });
    return "claimed" as const;
  });

  return {
    status,
    /** Gives the right back after a failed send, so a retry can mail again. */
    release: async () => {
      if (status !== "claimed") return;
      await db
        .delete(SentNotice)
        .where(sql`${SentNotice.key} in (${key}, ${sendKey})`);
    },
  };
}

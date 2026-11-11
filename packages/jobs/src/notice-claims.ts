import { and, type Database, eq, isNull, lte, SentNotice } from "@synoro/db";

/**
 * Claims in `sent_notices`: a mail that must go out once per occasion is
 * claimed for five minutes before it is sent and marked sent once it is
 * handed over. A second worker skips a live claim, a failed send gives the
 * claim back, and a crashed worker's claim expires for the next run (a crash
 * right after sending can repeat the mail).
 */

/** Longer than the workflow's 120-second execution timeout. */
const CLAIM_MS = 5 * 60 * 1000;

export interface NoticeClaim {
  /** Marks the notice sent; call once the mail is handed over. */
  done: () => Promise<void>;
  /** Gives the claim back after a failed send, so the next run retries. */
  release: () => Promise<void>;
}

/**
 * Claim `key` for `userId`; undefined when it was sent already or another
 * worker holds a live claim. A worker whose lease expired cannot release or
 * finish a newer claim: both calls check the claim token.
 */
export async function claimNotice(
  db: Database,
  key: string,
  userId: string,
): Promise<NoticeClaim | undefined> {
  const claimToken = crypto.randomUUID();
  const claimedAt = new Date();
  const claimExpiresAt = new Date(claimedAt.getTime() + CLAIM_MS);
  const claimed = await db
    .insert(SentNotice)
    .values({ key, userId, claimToken, claimExpiresAt })
    .onConflictDoUpdate({
      target: SentNotice.key,
      set: { claimToken, claimExpiresAt },
      setWhere: and(
        isNull(SentNotice.sentAt),
        lte(SentNotice.claimExpiresAt, claimedAt),
      ),
    })
    .returning({ key: SentNotice.key });
  if (claimed.length === 0) return undefined;

  const ownsClaim = and(
    eq(SentNotice.key, key),
    eq(SentNotice.claimToken, claimToken),
    isNull(SentNotice.sentAt),
  );
  return {
    done: async () => {
      await db
        .update(SentNotice)
        .set({ sentAt: new Date(), claimToken: null, claimExpiresAt: null })
        .where(ownsClaim);
    },
    release: async () => {
      await db.delete(SentNotice).where(ownsClaim);
    },
  };
}

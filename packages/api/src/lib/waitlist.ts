import {
  and,
  count,
  type Database,
  eq,
  gte,
  isNotNull,
  isNull,
  sql,
  WaitlistEntry,
} from "@synoro/db";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Takes the lock that serialises changes to one person's wishes at one
 * practice (until the transaction ends): two requests at once can't both
 * pass the limit.
 */
export async function lockWishes(tx: Tx, practiceId: string, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`waitlist:${practiceId}:${userId}`}))`,
  );
}

/**
 * The person's wishes at the practice that are confirmed, not yet told of
 * anything and not over — what the limit counts. A visitor's wish waiting
 * for its emailed link is not one of them (it has its own, short life).
 */
export async function countOpenWishes(
  tx: Tx,
  practiceId: string,
  userId: string,
  today: string,
) {
  const [open] = await tx
    .select({ entries: count() })
    .from(WaitlistEntry)
    .where(
      and(
        eq(WaitlistEntry.practiceId, practiceId),
        eq(WaitlistEntry.userId, userId),
        isNotNull(WaitlistEntry.confirmedAt),
        isNull(WaitlistEntry.notifiedAt),
        gte(WaitlistEntry.toDate, today),
      ),
    );
  return open?.entries ?? 0;
}

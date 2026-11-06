import { env, logger, paths } from "@synoro/config";
import { decryptSecret } from "@synoro/config/secrets";
import {
  AccountDeletion,
  account,
  and,
  Booking,
  count,
  type Database,
  DataExport,
  DeletionRecord,
  eq,
  GoogleCalendarConnection,
  gt,
  inArray,
  isNotNull,
  lte,
  Practice,
  PracticeMember,
  PracticeSlugAlias,
  ReservedSlug,
  SlugOrder,
  type SQLWrapper,
  SubscriptionPayment,
  session,
  sql,
  user,
} from "@synoro/db";

import { revokeToken } from "./google";
import { dispatchEmail } from "./index";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a deleted account can be brought back. */
export const DELETION_GRACE_DAYS = 30;
/** How long a deleted practice's address stays closed to others. */
const SLUG_RESERVE_DAYS = 365;
/** The bank may still settle a payment this young: it must find its row. */
const PENDING_WINDOW_MS = DAY_MS;
const MAX_BATCH = 50;

/**
 * SQL for «this owner isn't leaving». Their practices are closed: nothing goes
 * out on their behalf while the account can still be brought back.
 */
export function ownerStaying(ownerId: SQLWrapper) {
  return sql`not exists (select 1 from ${AccountDeletion} where ${AccountDeletion.userId} = ${ownerId})`;
}

/** A payment link is open or a renewal is being charged. */
export async function hasPaymentInProgress(
  db: Database,
  userId: string,
  now = new Date(),
) {
  const since = new Date(now.getTime() - PENDING_WINDOW_MS);
  const [payment, order] = await Promise.all([
    db
      .select({ id: SubscriptionPayment.id })
      .from(SubscriptionPayment)
      .where(
        and(
          eq(SubscriptionPayment.userId, userId),
          eq(SubscriptionPayment.status, "pending"),
          gt(SubscriptionPayment.createdAt, since),
        ),
      )
      .limit(1),
    db
      .select({ id: SlugOrder.id })
      .from(SlugOrder)
      .where(
        and(
          eq(SlugOrder.userId, userId),
          eq(SlugOrder.status, "pending"),
          gt(SlugOrder.createdAt, since),
        ),
      )
      .limit(1),
  ]);
  return payment.length > 0 || order.length > 0;
}

export async function mailDeletionRequested(
  to: string,
  purgeAt: Date,
  timeZone: string,
) {
  await dispatchEmail({
    template: "account-deletion",
    to: [to],
    subject: "Запрос на удаление аккаунта",
    props: {
      purgeOn: new Intl.DateTimeFormat("ru-RU", {
        timeZone,
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(purgeAt),
      url: new URL(paths.settings.data, env.APP_URL).href,
    },
  });
}

/** What leaves the process during a purge: replaced in tests. */
export interface PurgeDeps {
  removeFile(key: string): Promise<void>;
  revokeGoogle(refreshToken: string): Promise<void>;
}

const defaultPurgeDeps: PurgeDeps = {
  async removeFile(key) {
    const { deleteObjectFromS3 } = await import("@synoro/storage");
    await deleteObjectFromS3(key);
  },
  async revokeGoogle(refreshToken) {
    await revokeToken(decryptSecret(refreshToken));
  },
};

/**
 * Accounts that exist only because someone booked with this practice: created
 * passively (`findOrCreateGuestMember`), never verified, never signed in, and a
 * client of nobody else. Left behind, their names and phones would outlive the
 * practice with nobody to ask to delete them.
 */
async function passiveClients(db: Database, practiceIds: string[]) {
  if (practiceIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ id: user.id })
    .from(PracticeMember)
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(
      and(
        inArray(PracticeMember.practiceId, practiceIds),
        eq(PracticeMember.role, "client"),
        eq(user.emailVerified, false),
        sql`not exists (select 1 from ${account} where ${account.userId} = ${user.id})`,
        sql`not exists (select 1 from ${session} where ${session.userId} = ${user.id})`,
        sql`not exists (select 1 from ${PracticeMember} other where other.user_id = ${user.id} and other.practice_id not in (${sql.join(
          practiceIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}))`,
      ),
    );
  return rows.map((row) => row.id);
}

/** Delete one account for good. False: a payment is in flight, try tomorrow. */
export async function purgeAccount(
  db: Database,
  userId: string,
  requestedAt: Date,
  deps: PurgeDeps = defaultPurgeDeps,
  now = new Date(),
) {
  if (await hasPaymentInProgress(db, userId, now)) return false;

  const practices = await db
    .select({ id: Practice.id, slug: Practice.slug, image: Practice.image })
    .from(Practice)
    .where(eq(Practice.ownerId, userId));
  const practiceIds = practices.map((practice) => practice.id);

  const [aliases, exports_, connections, clients, members, bookings] =
    await Promise.all([
      practiceIds.length
        ? db
            .select({ slug: PracticeSlugAlias.slug })
            .from(PracticeSlugAlias)
            .where(inArray(PracticeSlugAlias.practiceId, practiceIds))
        : [],
      db
        .select({ fileKey: DataExport.fileKey })
        .from(DataExport)
        .where(
          and(eq(DataExport.userId, userId), isNotNull(DataExport.fileKey)),
        ),
      practiceIds.length
        ? db
            .select({ refreshToken: GoogleCalendarConnection.refreshToken })
            .from(GoogleCalendarConnection)
            .where(inArray(GoogleCalendarConnection.practiceId, practiceIds))
        : [],
      passiveClients(db, practiceIds),
      practiceIds.length
        ? db
            .select({ value: count() })
            .from(PracticeMember)
            .where(
              and(
                inArray(PracticeMember.practiceId, practiceIds),
                eq(PracticeMember.role, "client"),
              ),
            )
        : [{ value: 0 }],
      practiceIds.length
        ? db
            .select({ value: count() })
            .from(Booking)
            .where(inArray(Booking.practiceId, practiceIds))
        : [{ value: 0 }],
    ]);

  const until = new Date(now.getTime() + SLUG_RESERVE_DAYS * DAY_MS);
  const slugs = [
    ...practices.map((practice) => practice.slug),
    ...aliases.map((alias) => alias.slug),
  ];

  await db.transaction(async (tx) => {
    if (slugs.length > 0) {
      await tx
        .insert(ReservedSlug)
        .values(slugs.map((slug) => ({ slug, until })))
        .onConflictDoUpdate({
          target: ReservedSlug.slug,
          set: { until },
        });
    }
    // What stays for the tax office says nothing of who it was.
    await tx
      .update(SubscriptionPayment)
      .set({
        confirmationUrl: null,
        yclid: null,
        yclidAt: null,
        ymClientId: null,
        status: sql`case when ${SubscriptionPayment.status} = 'pending' then 'canceled'::payment_status else ${SubscriptionPayment.status} end`,
      })
      .where(eq(SubscriptionPayment.userId, userId));
    await tx
      .update(SlugOrder)
      .set({
        confirmationUrl: null,
        status: sql`case when ${SlugOrder.status} = 'pending' then 'canceled'::payment_status else ${SlugOrder.status} end`,
      })
      .where(eq(SlugOrder.userId, userId));

    if (clients.length > 0) {
      await tx.delete(user).where(inArray(user.id, clients));
    }
    await tx.delete(user).where(eq(user.id, userId));
    await tx.insert(DeletionRecord).values({
      practices: practices.length,
      clients: members[0]?.value ?? 0,
      bookings: bookings[0]?.value ?? 0,
      requestedAt,
      purgedAt: now,
    });
  });

  // The rows are gone; files and tokens outside are best effort, and logged by
  // count only: their names hold the ids this just erased.
  const files = [
    ...practices.flatMap((practice) =>
      // The demo seed stores a path from `public/` instead of a key.
      practice.image?.startsWith("practices/") ? [practice.image] : [],
    ),
    ...exports_.flatMap((row) => (row.fileKey ? [row.fileKey] : [])),
  ];
  const outcomes = await Promise.allSettled([
    ...files.map((key) => deps.removeFile(key)),
    ...connections.map((row) => deps.revokeGoogle(row.refreshToken)),
  ]);
  const failed = outcomes.filter((o) => o.status === "rejected").length;
  if (failed > 0) logger.warn("account.purge_leftovers", { failed });
  return true;
}

/** Daily: every account past its term, and addresses whose year is over. */
export async function purgeDueAccounts(
  db: Database,
  deps: PurgeDeps = defaultPurgeDeps,
  now = new Date(),
) {
  const due = await db
    .select()
    .from(AccountDeletion)
    .where(lte(AccountDeletion.purgeAt, now))
    .limit(MAX_BATCH);

  let purged = 0;
  for (const row of due) {
    try {
      if (await purgeAccount(db, row.userId, row.requestedAt, deps, now)) {
        purged++;
      }
    } catch (error) {
      logger.error("account.purge_failed", error);
    }
  }

  await db.delete(ReservedSlug).where(lte(ReservedSlug.until, now));
  return { purged };
}

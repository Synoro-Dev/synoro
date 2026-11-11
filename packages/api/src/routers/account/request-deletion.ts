import { isAdmin } from "@synoro/auth/roles";
import {
  AccountDeletion,
  and,
  asc,
  Booking,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  Practice,
  SubscriptionAutorenewal,
} from "@synoro/db";
import {
  DELETION_GRACE_DAYS,
  hasPaymentInProgress,
  mailDeletionRequested,
} from "@synoro/jobs/account-deletion";
import { recordDataAudit } from "@synoro/jobs/data-export";
import { z } from "zod";

import { cancelActiveBooking } from "../../lib/bookings";
import { dataProcedure, hasFreshAccess } from "../../lib/data-access";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ask to delete the account. Its practices close at once, notices stop and
 * auto-renewal is turned off; in 30 days the `account-purge` cron deletes
 * everything, and until then `cancelDeletion` brings it back. With
 * `cancelBookings` upcoming bookings are cancelled now and clients who can be
 * reached are told, with their consultations back on the balance.
 *
 * The steps after the request can fail halfway, so they're safe to repeat: asking
 * again finishes them with the first date and the first choice, and the journal
 * line goes in once.
 *
 * Owners of a practice only: a client's account holds the balance and history
 * the specialist also keeps, which is a question of its own.
 *
 * @example client.account.requestDeletion({ confirm: "anna@example.com", cancelBookings: true })
 */
export const requestDeletion = dataProcedure
  .errors({
    CONFIRMATION_MISMATCH: { message: "Почта для подтверждения не совпадает" },
    NO_PRACTICE: {
      message: "Удалить аккаунт без своей практики можно через поддержку",
    },
    IS_ADMIN: { message: "Это администратор Synoro: сначала снимите роль" },
    PAYMENT_IN_PROGRESS: {
      message:
        "Есть неоплаченный платёж за последние сутки: банк ещё может его провести. Попробуйте завтра",
    },
  })
  .input(
    z.object({
      /** Repeats the account's email, so a stray click can't delete anything. */
      confirm: z.string(),
      cancelBookings: z.boolean(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    const { session, user } = context.session;
    if (!(await hasFreshAccess(db, session.id))) {
      throw errors.ACCESS_REQUIRED();
    }
    if (input.confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw errors.CONFIRMATION_MISMATCH();
    }
    if (isAdmin(user)) throw errors.IS_ADMIN();

    const practices = await db
      .select({ id: Practice.id, timezone: Practice.timezone })
      .from(Practice)
      .where(eq(Practice.ownerId, user.id))
      .orderBy(asc(Practice.createdAt));
    if (practices.length === 0) throw errors.NO_PRACTICE();

    const existing = await db.query.AccountDeletion.findFirst({
      where: eq(AccountDeletion.userId, user.id),
    });
    if (!existing && (await hasPaymentInProgress(db, user.id))) {
      throw errors.PAYMENT_IN_PROGRESS();
    }

    const now = new Date();
    await db
      .insert(AccountDeletion)
      .values({
        userId: user.id,
        requestedAt: now,
        purgeAt: new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS),
        cancelBookings: input.cancelBookings,
      })
      .onConflictDoNothing();
    // Asked twice, or two tabs at once: the first date and choice stand.
    const request = await db.query.AccountDeletion.findFirst({
      where: eq(AccountDeletion.userId, user.id),
    });
    if (!request) throw new Error("Failed to insert account deletion");
    if (request.completedAt) return { purgeAt: request.purgeAt, cancelled: 0 };

    // The bank has no call to cancel it, so "canceled" means we stop charging.
    await db
      .update(SubscriptionAutorenewal)
      .set({ status: "canceled", canceledAt: now, cancelReason: "user" })
      .where(
        and(
          eq(SubscriptionAutorenewal.userId, user.id),
          eq(SubscriptionAutorenewal.status, "active"),
        ),
      );

    let cancelled = 0;
    if (request.cancelBookings) {
      const upcoming = await db
        .select({ id: Booking.id })
        .from(Booking)
        .where(
          and(
            inArray(
              Booking.practiceId,
              practices.map((practice) => practice.id),
            ),
            eq(Booking.status, "active"),
            gt(Booking.startsAt, now),
            ne(Booking.kind, "blocked"),
          ),
        );
      for (const { id } of upcoming) {
        const result = await cancelActiveBooking(db, id, {
          cancelledById: user.id,
          refund: true,
          reason: "staff",
        });
        if (result) cancelled++;
      }
    }

    await mailDeletionRequested(
      user.email,
      request.purgeAt,
      practices[0]?.timezone ?? "Europe/Moscow",
    );

    // Last, and once: whoever completes it writes the journal line.
    await db.transaction(async (tx) => {
      const [completed] = await tx
        .update(AccountDeletion)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(AccountDeletion.userId, user.id),
            isNull(AccountDeletion.completedAt),
          ),
        )
        .returning({ userId: AccountDeletion.userId });
      if (completed) {
        await recordDataAudit(tx as unknown as typeof db, {
          userId: user.id,
          actorId: user.id,
          action: "deletion_requested",
          details: { cancelled },
        });
      }
    });
    return { purgeAt: request.purgeAt, cancelled };
  });

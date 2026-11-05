import { isAdmin } from "@synoro/auth/roles";
import { logger } from "@synoro/config";
import {
  and,
  count,
  eq,
  gt,
  Practice,
  SlugOrder,
  SubscriptionPayment,
  user,
} from "@synoro/db";
import { z } from "zod";

import { adminProcedure } from "../../../orpc";

/** A pending payment younger than this may still be settled by the bank. */
const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Delete an account for good. Foreign keys do the cleanup: sessions, sign-ins,
 * memberships, «Про» subscription with auto-renewal (so it is never charged
 * again) and messenger chats go with the user, and so do the practices they
 * own, with their bookings. Authorship columns (`created_by`, …) turn null.
 *
 * Refused for the caller themselves, for admins (take the role away
 * first) and while a payment from the last 24 h is unpaid (the bank's answer
 * would find no row); `confirm` must repeat the user's email, so a stray call can't
 * delete anyone.
 *
 * @example await client.admin.users.remove({ id, confirm: "anna@example.com" })
 */
export const remove = adminProcedure
  .errors({
    NOT_FOUND: { message: "Пользователь не найден" },
    SELF: { message: "Нельзя удалить самого себя" },
    IS_ADMIN: {
      message: "Это администратор: сначала снимите с него роль",
    },
    PAYMENT_IN_PROGRESS: {
      message:
        "У пользователя есть неоплаченный платёж за последние сутки: банк ещё может его провести. Подождите или дождитесь результата",
    },
    CONFIRMATION_MISMATCH: {
      message: "Почта для подтверждения не совпадает",
    },
  })
  .input(z.object({ id: z.string().min(1), confirm: z.string() }))
  .handler(async ({ context, input, errors }) => {
    if (input.id === context.session.user.id) {
      throw errors.SELF();
    }

    const found = await context.db.query.user.findFirst({
      where: eq(user.id, input.id),
      columns: { id: true, email: true, role: true },
    });
    if (!found) {
      throw errors.NOT_FOUND();
    }
    if (isAdmin(found)) {
      throw errors.IS_ADMIN();
    }
    if (input.confirm.trim().toLowerCase() !== found.email.toLowerCase()) {
      throw errors.CONFIRMATION_MISMATCH();
    }

    // A payment link is open, or a renewal is being charged: the bank's
    // answer must find its row, so wait (older pending ones are abandoned).
    const since = new Date(Date.now() - PENDING_WINDOW_MS);
    const [pendingPayment, pendingOrder] = await Promise.all([
      context.db
        .select({ id: SubscriptionPayment.id })
        .from(SubscriptionPayment)
        .where(
          and(
            eq(SubscriptionPayment.userId, found.id),
            eq(SubscriptionPayment.status, "pending"),
            gt(SubscriptionPayment.createdAt, since),
          ),
        )
        .limit(1),
      context.db
        .select({ id: SlugOrder.id })
        .from(SlugOrder)
        .where(
          and(
            eq(SlugOrder.userId, found.id),
            eq(SlugOrder.status, "pending"),
            gt(SlugOrder.createdAt, since),
          ),
        )
        .limit(1),
    ]);
    if (pendingPayment.length > 0 || pendingOrder.length > 0) {
      throw errors.PAYMENT_IN_PROGRESS();
    }

    const [owned] = await context.db
      .select({ value: count() })
      .from(Practice)
      .where(eq(Practice.ownerId, found.id));

    await context.db.delete(user).where(eq(user.id, found.id));

    logger.info("admin.user_deleted", {
      userId: found.id,
      adminId: context.session.user.id,
      practices: owned?.value ?? 0,
    });
    return { id: found.id };
  });

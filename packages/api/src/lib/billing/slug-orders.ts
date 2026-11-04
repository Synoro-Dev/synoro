import { env, logger, paths } from "@synoro/config";
import {
  and,
  count,
  type Database,
  eq,
  gt,
  type PaymentStatus,
  SlugOrder,
} from "@synoro/db";
import { PREMIUM_SLUG_PRICE } from "@synoro/validators";

import { ProviderError } from "../payments/types";
import { findPracticeIdBySlug, moveToSlug } from "../practice-slugs";
import {
  createTochkaPayment,
  fetchTochkaPayment,
  isDemoBilling,
  isSandboxPayment,
  sandboxExternalId,
  tochkaAvailable,
  tochkaSandbox,
} from "./tochka";

type SlugOrderRow = typeof SlugOrder.$inferSelect;

/** A premium name is worth holding only briefly: the link lives half an hour. */
const LINK_TTL_MINUTES = 30;
/** A little longer than the link, so the bank has the last word on it. */
const HOLD_MS = 35 * 60 * 1000;
/** Unpaid orders one user may hold at once, so nobody can sit on all the names. */
const MAX_OPEN_ORDERS = 3;

/** Where Точка sends the specialist back: the page settings, which check it. */
function orderReturnUrl(order: { id: string; practiceId: string }) {
  const url = new URL(paths.booking.page(order.practiceId), env.APP_URL);
  url.searchParams.set("order", order.id);
  return url.href;
}

/**
 * Close a pending order, once. On success the practice moves to the address.
 * Holds make a name taken in the meantime impossible; if it happens anyway,
 * the money is in and a human has to give it back.
 */
async function settleSlugOrder(
  db: Database,
  orderId: string,
  status: PaymentStatus,
) {
  if (status === "canceled") {
    await db
      .update(SlugOrder)
      .set({ status: "canceled", confirmationUrl: null })
      .where(and(eq(SlugOrder.id, orderId), eq(SlugOrder.status, "pending")));
  } else if (status === "succeeded") {
    await db.transaction(async (tx) => {
      const [paid] = await tx
        .update(SlugOrder)
        .set({ status: "succeeded", paidAt: new Date(), confirmationUrl: null })
        .where(and(eq(SlugOrder.id, orderId), eq(SlugOrder.status, "pending")))
        .returning();
      if (!paid) return;
      const holder = await findPracticeIdBySlug(tx, paid.slug);
      if (holder && holder !== paid.practiceId) {
        logger.error("slug_order.name_taken", undefined, {
          orderId,
          slug: paid.slug,
        });
        return;
      }
      await moveToSlug(tx, paid.practiceId, paid.slug);
    });
  }
  const order = await db.query.SlugOrder.findFirst({
    where: eq(SlugOrder.id, orderId),
  });
  if (!order) throw new Error(`Slug order ${orderId} vanished`);
  return order;
}

/**
 * Ask Точка about a pending order and settle it. An order the bank never saw
 * (its link failed to open, or the sandbox opened it) lapses with its hold;
 * any other waits for the bank's word, since its link may still be paid.
 */
export async function syncSlugOrder(db: Database, order: SlugOrderRow) {
  if (order.status !== "pending") return order;
  if (!order.externalId || isSandboxPayment(order)) {
    return order.holdUntil > new Date()
      ? order
      : settleSlugOrder(db, order.id, "canceled");
  }
  if (!tochkaAvailable() || tochkaSandbox()) return order;

  try {
    const remote = await fetchTochkaPayment(order.externalId);
    if (remote.status === "pending") return order;
    if (
      remote.status === "succeeded" &&
      Math.round(remote.amount * 100) !== order.amount
    ) {
      logger.error("slug_order.amount_mismatch", undefined, {
        orderId: order.id,
        expected: order.amount,
        received: remote.amount,
      });
      return order;
    }
    const settled = await settleSlugOrder(db, order.id, remote.status);
    logger.info("slug_order.settled", {
      orderId: order.id,
      status: settled.status,
    });
    return settled;
  } catch (error) {
    logger.warn("slug_order.sync_failed", {
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof ProviderError) return order;
    throw error;
  }
}

/** The order holding a name right now; one past its hold is checked first. */
export async function findOpenSlugOrder(db: Database, slug: string) {
  const open = await db.query.SlugOrder.findFirst({
    where: and(eq(SlugOrder.slug, slug), eq(SlugOrder.status, "pending")),
  });
  if (!open || open.holdUntil > new Date()) return open;
  const synced = await syncSlugOrder(db, open);
  return synced.status === "pending" ? synced : undefined;
}

/**
 * Open a Точка payment link for a premium address. The same practice asking
 * again gets its open link back. Throws `ProviderError` when the bank
 * refuses; the row is then dropped, since nothing was charged.
 */
export async function startSlugOrder(
  db: Database,
  input: {
    user: { id: string; email: string };
    practiceId: string;
    slug: string;
  },
) {
  const open = await findOpenSlugOrder(db, input.slug);
  if (open) {
    return open.practiceId === input.practiceId && open.confirmationUrl
      ? {
          result: "started" as const,
          orderId: open.id,
          confirmationUrl: open.confirmationUrl,
        }
      : { result: "taken" as const };
  }
  // Checking an old order above may have just sold the name.
  if (await findPracticeIdBySlug(db, input.slug)) {
    return { result: "taken" as const };
  }

  const [opened] = await db
    .select({ orders: count() })
    .from(SlugOrder)
    .where(
      and(
        eq(SlugOrder.userId, input.user.id),
        eq(SlugOrder.status, "pending"),
        gt(SlugOrder.holdUntil, new Date()),
      ),
    );
  if ((opened?.orders ?? 0) >= MAX_OPEN_ORDERS) {
    return { result: "too_many" as const };
  }

  const [order] = await db
    .insert(SlugOrder)
    .values({
      userId: input.user.id,
      practiceId: input.practiceId,
      slug: input.slug,
      amount: PREMIUM_SLUG_PRICE,
      holdUntil: new Date(Date.now() + HOLD_MS),
    })
    .onConflictDoNothing()
    .returning();
  // Someone else opened an order for this name a moment ago.
  if (!order) return { result: "taken" as const };

  if (isDemoBilling()) {
    await db
      .update(SlugOrder)
      .set({ externalId: `demo-${order.id}` })
      .where(eq(SlugOrder.id, order.id));
    await settleSlugOrder(db, order.id, "succeeded");
    return {
      result: "started" as const,
      orderId: order.id,
      confirmationUrl: orderReturnUrl(order),
    };
  }

  try {
    const remote = await createTochkaPayment({
      orderId: order.id,
      amount: order.amount,
      purpose: `Заказ адреса ${order.number}. Адрес /${order.slug} страницы записи в Synoro`,
      itemName: `Адрес страницы записи /${order.slug} в Synoro`,
      email: input.user.email,
      returnUrl: orderReturnUrl(order),
      ttlMinutes: LINK_TTL_MINUTES,
    });
    // As with «Про»: the sandbox's link can't be paid, the page confirms it.
    const sandbox = tochkaSandbox();
    const confirmationUrl = sandbox
      ? orderReturnUrl(order)
      : remote.confirmationUrl;
    await db
      .update(SlugOrder)
      .set({
        externalId: sandbox ? sandboxExternalId(order.id) : remote.externalId,
        confirmationUrl,
      })
      .where(eq(SlugOrder.id, order.id));
    return {
      result: "started" as const,
      orderId: order.id,
      confirmationUrl,
    };
  } catch (error) {
    await db.delete(SlugOrder).where(eq(SlugOrder.id, order.id));
    throw error;
  }
}

/**
 * Sandbox only: play the bank for the caller's pending order, as
 * `settleSandboxPayment` does for «Про». Returns undefined for an order that
 * isn't the caller's, isn't from the sandbox, or when the sandbox is off.
 */
export async function settleSandboxSlugOrder(
  db: Database,
  input: {
    userId: string;
    orderId: string;
    outcome: Extract<PaymentStatus, "succeeded" | "canceled">;
  },
) {
  if (!tochkaSandbox()) return undefined;
  const found = await db.query.SlugOrder.findFirst({
    where: and(
      eq(SlugOrder.id, input.orderId),
      eq(SlugOrder.userId, input.userId),
    ),
  });
  if (!found || !isSandboxPayment(found)) return undefined;
  if (found.status !== "pending") return found;
  return settleSlugOrder(db, found.id, input.outcome);
}

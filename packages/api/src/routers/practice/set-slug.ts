import { logger } from "@synoro/config";
import { isPremiumSlug, practiceSlugFormSchema } from "@synoro/validators";
import { z } from "zod";

import { billingAvailable } from "../../lib/billing";
import { startSlugOrder } from "../../lib/billing/slug-orders";
import { ProviderError } from "../../lib/payments";
import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { findPracticeIdBySlug, moveToSlug } from "../../lib/practice-slugs";
import { publicBookingUrl } from "../../lib/urls";

/**
 * Change the booking page's address — owner only. The old address keeps
 * leading to the page. A free address (or one the practice had before) changes
 * at once; a premium one returns the payment to redirect to, and changes once
 * it is paid.
 *
 * @example await client.practice.setSlug({ practiceId, slug: "max" })
 */
export const setSlug = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Адрес меняет владелец практики" },
    CONFLICT: {
      message: "Этот адрес уже занят",
      data: z.object({ field: z.literal("slug") }),
    },
    PREMIUM_UNAVAILABLE: {
      message:
        "Короткие адреса сейчас не продаются, выберите адрес от 5 символов",
    },
    TOO_MANY_ORDERS: {
      message: "Сначала оплатите начатые заказы или подождите 30 минут",
    },
    PROVIDER_ERROR: { message: "Банк не принял платёж, попробуйте позже" },
  })
  .input(practiceSlugFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { db, session } = context;
    const owner = await findOwnerMembership(
      db,
      input.practiceId,
      session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const holder = await findPracticeIdBySlug(db, input.slug);
    if (holder && holder !== owner.practiceId) {
      throw errors.CONFLICT({ data: { field: "slug" } });
    }

    if (holder || !isPremiumSlug(input.slug)) {
      if (!(await moveToSlug(db, owner.practiceId, input.slug))) {
        throw errors.CONFLICT({ data: { field: "slug" } });
      }
      return {
        status: "changed" as const,
        bookingUrl: publicBookingUrl(input.slug),
      };
    }

    if (!billingAvailable()) throw errors.PREMIUM_UNAVAILABLE();
    try {
      const order = await startSlugOrder(db, {
        user: session.user,
        practiceId: owner.practiceId,
        slug: input.slug,
      });
      if (order.result === "taken") {
        throw errors.CONFLICT({ data: { field: "slug" } });
      }
      if (order.result === "too_many") throw errors.TOO_MANY_ORDERS();
      return {
        status: "payment" as const,
        orderId: order.orderId,
        confirmationUrl: order.confirmationUrl,
      };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      logger.error("slug_order.create_failed", error, {
        userId: session.user.id,
        kind: error.kind,
      });
      throw errors.PROVIDER_ERROR({ cause: error });
    }
  });

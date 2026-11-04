import { logger } from "@synoro/config";
import { isUniqueViolation, Practice, PracticeMember } from "@synoro/db";
import { isPremiumSlug, practiceFormSchema } from "@synoro/validators";
import { z } from "zod";

import { billingAvailable, ensureSubscription } from "../../lib/billing";
import {
  findOpenSlugOrder,
  startSlugOrder,
} from "../../lib/billing/slug-orders";
import { ProviderError } from "../../lib/payments";
import { findPracticeIdBySlug } from "../../lib/practice-slugs";
import { protectedProcedure } from "../../orpc";

/**
 * Create a practice (the SaaS tenant) — any signed-in user can; they become
 * its owner. The first one starts their 14-day «Про» trial.
 *
 * A premium address (`isPremiumSlug`) has to be bought: the practice opens at
 * once on a temporary address, and `slugOrder` is the payment that moves it
 * to the chosen one. `slugOrder` is null when the payment could not start;
 * the address can then be bought in the page settings.
 *
 * Throws CONFLICT (with `data.field`) when the public address is taken.
 *
 * @example client.practice.create({ name: "Анна Иванова", slug: "anna-ivanova", profession: "tutor" })
 */
export const create = protectedProcedure
  .errors({
    CONFLICT: {
      message: "Этот адрес уже занят",
      data: z.object({ field: z.literal("slug") }),
    },
    PREMIUM_UNAVAILABLE: {
      message:
        "Короткие адреса сейчас не продаются, выберите адрес от 5 символов",
    },
  })
  .input(practiceFormSchema)
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const ownerId = user.id;
    const premium = isPremiumSlug(input.slug);

    if (premium && !billingAvailable()) throw errors.PREMIUM_UNAVAILABLE();
    if (
      (await findPracticeIdBySlug(context.db, input.slug)) ||
      (premium && (await findOpenSlugOrder(context.db, input.slug)))
    ) {
      throw errors.CONFLICT({ data: { field: "slug" } });
    }

    let practice: typeof Practice.$inferSelect | undefined;
    try {
      [practice] = await context.db
        .insert(Practice)
        .values({
          name: input.name,
          slug: premium
            ? `${input.slug}-${crypto.randomUUID().slice(0, 6)}`
            : input.slug,
          profession: input.profession,
          ownerId,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, "practices_slug_unique")) {
        throw errors.CONFLICT({ data: { field: "slug" }, cause: error });
      }
      throw error;
    }
    if (!practice) throw new Error("Failed to insert practice");

    await context.db
      .insert(PracticeMember)
      .values({ practiceId: practice.id, userId: ownerId, role: "owner" });
    await ensureSubscription(context.db, ownerId);

    if (!premium) return { ...practice, slugOrder: null };

    try {
      const order = await startSlugOrder(context.db, {
        user,
        practiceId: practice.id,
        slug: input.slug,
      });
      return {
        ...practice,
        slugOrder: order.result === "started" ? order : null,
      };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      logger.error("slug_order.create_failed", error, {
        userId: ownerId,
        kind: error.kind,
      });
      return { ...practice, slugOrder: null };
    }
  });

import { logger } from "@synoro/config";
import {
  isUniqueViolation,
  Practice,
  PracticeMember,
  Service,
} from "@synoro/db";
import { newPracticeNotice } from "@synoro/jobs";
import {
  capitalize,
  isPremiumSlug,
  practiceFormSchema,
  professionTerms,
} from "@synoro/validators";
import { z } from "zod";

import { billingAvailable, ensureSubscription } from "../../lib/billing";
import {
  findOpenSlugOrder,
  startSlugOrder,
} from "../../lib/billing/slug-orders";
import { ProviderError } from "../../lib/payments";
import {
  findPracticeIdBySlug,
  isSlugReserved,
  lockSlugs,
} from "../../lib/practice-slugs";
import { protectedProcedure } from "../../orpc";

/**
 * Create a practice (the SaaS tenant) — any signed-in user can; they become
 * its owner. The first one starts their 14-day «Про» trial. A practice starts
 * with one service, an hour for one credit.
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
    if (premium && (await findOpenSlugOrder(context.db, input.slug))) {
      throw errors.CONFLICT({ data: { field: "slug" } });
    }

    let practice: typeof Practice.$inferSelect | undefined;
    try {
      practice = await context.db.transaction(async (tx) => {
        await lockSlugs(tx, [input.slug]);
        if (
          (await findPracticeIdBySlug(tx, input.slug)) ||
          (await isSlugReserved(tx, input.slug))
        ) {
          throw errors.CONFLICT({ data: { field: "slug" } });
        }
        const [inserted] = await tx
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
        return inserted;
      });
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
    // The one service every practice starts with: an hour for one credit,
    // named in the profession's words («Консультация», «Занятие»…).
    await context.db.insert(Service).values({
      practiceId: practice.id,
      name: capitalize(professionTerms(practice.profession).credit[0]),
      minutes: 60,
      credits: 1,
    });
    await ensureSubscription(context.db, ownerId);

    // The team hears of it, unawaited: without Hatchet the mail goes inline,
    // and a slow or failed one must not hold up the answer or the payment.
    const notice = newPracticeNotice(practice, user);
    if (notice) {
      void context.sendEmail(notice).catch((error: unknown) =>
        logger.warn("practice.notice_failed", {
          practiceId: practice.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

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

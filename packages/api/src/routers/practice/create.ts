import { isUniqueViolation, Practice, PracticeMember } from "@synoro/db";
import { practiceFormSchema } from "@synoro/validators";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Create a practice (the SaaS tenant) — any signed-in user can; they become
 * its owner.
 *
 * Throws CONFLICT (with `data.field`) when the public address is taken.
 *
 * @example client.practice.create({ name: "Анна Иванова", slug: "anna", profession: "tutor" })
 */
export const create = protectedProcedure
  .errors({
    CONFLICT: {
      message: "Этот адрес уже занят",
      data: z.object({ field: z.literal("slug") }),
    },
  })
  .input(practiceFormSchema)
  .handler(async ({ context, input, errors }) => {
    const ownerId = context.session.user.id;

    let practice: typeof Practice.$inferSelect | undefined;
    try {
      [practice] = await context.db
        .insert(Practice)
        .values({
          name: input.name,
          slug: input.slug,
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

    return practice;
  });

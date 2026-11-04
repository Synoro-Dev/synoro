import { z } from "zod";

import { publicPractice } from "../../lib/practice-access";
import { findPracticeIdBySlug } from "../../lib/practice-slugs";
import { publicProcedure } from "../../orpc";

/**
 * Public info for the booking page `/<slug>`, plus the caller's
 * membership (role, balance) when signed in. A former address finds the
 * practice too: `slug` in the answer is the current one.
 *
 * @example client.practice.bySlug({ slug: "anna" })
 */
export const bySlug = publicProcedure
  .errors({ NOT_FOUND: { message: "Страница записи не найдена" } })
  .input(z.object({ slug: z.string().min(1).max(48) }))
  .handler(async ({ context, input, errors }) => {
    const practiceId = await findPracticeIdBySlug(
      context.db,
      input.slug.toLowerCase(),
    );
    const practice = practiceId && (await publicPractice(context, practiceId));
    if (!practice) throw errors.NOT_FOUND();
    return practice;
  });

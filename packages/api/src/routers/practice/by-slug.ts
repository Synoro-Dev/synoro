import { eq, Practice } from "@synoro/db";
import { z } from "zod";

import { publicPractice } from "../../lib/practice-access";
import { publicProcedure } from "../../orpc";

/**
 * Public info for the booking page `/p/<slug>`, plus the caller's
 * membership (role, balance) when signed in.
 *
 * @example client.practice.bySlug({ slug: "anna" })
 */
export const bySlug = publicProcedure
  .errors({ NOT_FOUND: { message: "Страница записи не найдена" } })
  .input(z.object({ slug: z.string().min(1).max(48) }))
  .handler(async ({ context, input, errors }) => {
    const match = await context.db.query.Practice.findFirst({
      where: eq(Practice.slug, input.slug.toLowerCase()),
      columns: { id: true },
    });
    const practice = match && (await publicPractice(context, match.id));
    if (!practice) throw errors.NOT_FOUND();
    return practice;
  });

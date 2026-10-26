import { eq, Practice } from "@synoro/db";
import { z } from "zod";

import { findMembership } from "../../lib/practice-access";
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
    const practice = await context.db.query.Practice.findFirst({
      where: eq(Practice.slug, input.slug.toLowerCase()),
      columns: { id: true, name: true, slug: true, timezone: true },
    });
    if (!practice) throw errors.NOT_FOUND();

    const userId = context.session?.user.id;
    const member = userId
      ? await findMembership(context.db, practice.id, userId)
      : undefined;

    return {
      ...practice,
      membership: member
        ? { id: member.id, role: member.role, credits: member.credits }
        : null,
    };
  });

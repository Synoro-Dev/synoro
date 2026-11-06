import { and, eq, PracticeDomain } from "@synoro/db";
import { normalizeHostname } from "@synoro/validators";
import { z } from "zod";

import { publicPractice } from "../../lib/practice-access";
import { publicProcedure } from "../../orpc";

/**
 * The practice an active connected domain serves. Same shape as `bySlug`.
 * Also answers the on-demand TLS check, so unknown and pending hosts get no
 * certificate.
 *
 * @example client.practice.byHost({ host: "anna-ivanova.ru" })
 */
export const byHost = publicProcedure
  .errors({ NOT_FOUND: { message: "Страница записи не найдена" } })
  .input(z.object({ host: z.string().max(300) }))
  .handler(async ({ context, input, errors }) => {
    const host = normalizeHostname(input.host);
    if (!host) throw errors.NOT_FOUND();

    const [domain] = await context.db
      .select({ id: PracticeDomain.practiceId })
      .from(PracticeDomain)
      .where(
        and(
          eq(PracticeDomain.hostname, host),
          eq(PracticeDomain.status, "active"),
        ),
      );
    const practice = domain && (await publicPractice(context, domain.id));
    if (!practice) throw errors.NOT_FOUND();
    return practice;
  });

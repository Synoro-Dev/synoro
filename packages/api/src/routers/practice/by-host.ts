import { and, eq, Practice, PracticeDomain } from "@synoro/db";
import { normalizeHostname } from "@synoro/validators";
import { z } from "zod";

import { slugFromPlatformHost } from "../../lib/domains";
import { publicPractice } from "../../lib/practice-access";
import { publicProcedure } from "../../orpc";

/**
 * The practice a host serves: a platform subdomain (`anna.<root>`) or an
 * active connected domain. Same shape as `bySlug`. Also answers the
 * on-demand TLS check, so unknown and pending hosts get no certificate.
 *
 * @example client.practice.byHost({ host: "anna-psy.ru" })
 */
export const byHost = publicProcedure
  .errors({ NOT_FOUND: { message: "Страница записи не найдена" } })
  .input(z.object({ host: z.string().max(300) }))
  .handler(async ({ context, input, errors }) => {
    const host = normalizeHostname(input.host);
    if (!host) throw errors.NOT_FOUND();

    const slug = slugFromPlatformHost(host);
    const [match] = await (slug
      ? context.db
          .select({ id: Practice.id })
          .from(Practice)
          .where(eq(Practice.slug, slug))
      : context.db
          .select({ id: PracticeDomain.practiceId })
          .from(PracticeDomain)
          .where(
            and(
              eq(PracticeDomain.hostname, host),
              eq(PracticeDomain.status, "active"),
            ),
          ));
    const practice = match && (await publicPractice(context, match.id));
    if (!practice) throw errors.NOT_FOUND();
    return practice;
  });

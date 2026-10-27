import { eq, isUniqueViolation, PracticeDomain } from "@acme/db";
import { customDomainFormSchema } from "@acme/validators";
import { z } from "zod";

import { domainSettings, isPlatformHost } from "../../lib/domains";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Connect the owner's domain (or replace the connected one). It starts
 * `pending` with a fresh token and serves the page only after `verify`
 * finds the TXT record — so nobody can claim a domain they don't control.
 *
 * @example client.domain.connect({ practiceId, hostname: "anna-psy.ru" })
 */
export const connect = ownerProcedure
  .errors({
    CONFLICT: { message: "Этот домен уже подключён к другой странице" },
    PLATFORM_DOMAIN: { message: "Это адрес платформы — укажите свой домен" },
  })
  .input(customDomainFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();
    if (isPlatformHost(input.hostname)) throw errors.PLATFORM_DOMAIN();

    const current = await context.db.query.PracticeDomain.findFirst({
      where: eq(PracticeDomain.practiceId, input.practiceId),
      columns: { hostname: true },
    });
    // Re-submitting the same host keeps its token and status.
    if (current?.hostname !== input.hostname) {
      const fresh = {
        hostname: input.hostname,
        verificationToken: crypto.randomUUID().replaceAll("-", ""),
        status: "pending" as const,
        verifiedAt: null,
        lastCheckedAt: null,
      };
      try {
        await context.db
          .insert(PracticeDomain)
          .values({ practiceId: input.practiceId, ...fresh })
          .onConflictDoUpdate({
            target: PracticeDomain.practiceId,
            set: fresh,
          });
      } catch (error) {
        if (isUniqueViolation(error, "practice_domains_hostname_unique")) {
          throw errors.CONFLICT({ cause: error });
        }
        throw error;
      }
    }

    return domainSettings(context.db, input.practiceId);
  });

import { eq, PracticeDomain } from "@acme/db";
import { z } from "zod";

import { checkDomainDns, domainSettings } from "../../lib/domains";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Look up the domain's DNS now. The TXT record activates a pending domain;
 * `routing` only reports whether traffic reaches us yet. An active domain
 * stays active: if it stops pointing here, it simply gets no traffic.
 *
 * @example client.domain.verify({ practiceId })
 */
export const verify = ownerProcedure
  .errors({ NOT_FOUND: { message: "Домен не подключён" } })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const row = await context.db.query.PracticeDomain.findFirst({
      where: eq(PracticeDomain.practiceId, input.practiceId),
    });
    if (!row) throw errors.NOT_FOUND();

    const check = await checkDomainDns(row.hostname, row.verificationToken);
    const now = new Date();
    await context.db
      .update(PracticeDomain)
      .set(
        row.status === "pending" && check.ownership
          ? { status: "active", verifiedAt: now, lastCheckedAt: now }
          : { lastCheckedAt: now },
      )
      .where(eq(PracticeDomain.id, row.id));

    return { ...(await domainSettings(context.db, input.practiceId)), check };
  });

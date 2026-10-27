import { and, eq, gt, PracticeDomain } from "@synoro/db";
import { z } from "zod";

import {
  checkDomainDns,
  DOMAIN_RESERVATION_MS,
  domainSettings,
} from "../../lib/domains";
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
      .where(
        and(
          eq(PracticeDomain.id, row.id),
          eq(PracticeDomain.hostname, row.hostname),
          eq(PracticeDomain.verificationToken, row.verificationToken),
          eq(PracticeDomain.status, row.status),
          row.status === "pending"
            ? gt(
                PracticeDomain.createdAt,
                new Date(now.getTime() - DOMAIN_RESERVATION_MS),
              )
            : undefined,
        ),
      );

    return { ...(await domainSettings(context.db, input.practiceId)), check };
  });

import { z } from "zod";

import { domainSettings } from "../../lib/domains";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * The practice's page addresses: the platform subdomain and the connected
 * domain with the DNS records to add. Owner only.
 *
 * @example client.domain.get({ practiceId })
 */
export const get = ownerProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    return domainSettings(context.db, input.practiceId);
  });

import { eq, PracticeDomain } from "@acme/db";
import { z } from "zod";

import { domainSettings } from "../../lib/domains";
import { findOwnerMembership } from "../../lib/practice-access";
import { ownerProcedure } from "./owner";

/**
 * Disconnect the domain; the page stays on the platform addresses.
 *
 * @example client.domain.disconnect({ practiceId })
 */
export const disconnect = ownerProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    await context.db
      .delete(PracticeDomain)
      .where(eq(PracticeDomain.practiceId, input.practiceId));

    return domainSettings(context.db, input.practiceId);
  });

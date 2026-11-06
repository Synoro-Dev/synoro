import { and, asc, eq, Service } from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * The practice's services, switched-off ones too (not archived ones), in the order the
 * booking page shows them. Staff only; clients get the active ones with the
 * practice (`practice.bySlug`).
 *
 * @example client.service.list({ practiceId })
 */
export const list = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    const services = await context.db
      .select({
        id: Service.id,
        name: Service.name,
        minutes: Service.minutes,
        credits: Service.credits,
        active: Service.active,
      })
      .from(Service)
      .where(
        and(
          eq(Service.practiceId, input.practiceId),
          eq(Service.archived, false),
        ),
      )
      .orderBy(asc(Service.position), asc(Service.createdAt));
    return { services };
  });

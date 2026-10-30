import { asc, eq, Workflow } from "@synoro/db";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { OWNER_ONLY } from "./owner";

/**
 * The practice's message rules and whether its owner can use them (rules of
 * an owner without «Про» are kept but not sent). Owner only.
 *
 * @example client.workflow.list({ practiceId })
 */
export const list = practiceProcedure
  .errors({ FORBIDDEN: { message: OWNER_ONLY } })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const [pro, workflows] = await Promise.all([
      hasPro(context.db, context.session.user.id),
      context.db
        .select({
          id: Workflow.id,
          trigger: Workflow.trigger,
          amount: Workflow.amount,
          subject: Workflow.subject,
          text: Workflow.text,
          active: Workflow.active,
        })
        .from(Workflow)
        .where(eq(Workflow.practiceId, input.practiceId))
        .orderBy(asc(Workflow.createdAt), asc(Workflow.id)),
    ]);
    return { pro, workflows };
  });

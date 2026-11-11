import { count, eq, Practice, Workflow } from "@synoro/db";
import { MAX_WORKFLOWS, workflowFormSchema } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { OWNER_ONLY } from "./owner";

/**
 * Add a message rule — «Про» only. Owner only.
 *
 * @example client.workflow.create({ practiceId, trigger: "after_end", amount: 2, subject, text, active: true })
 */
export const create = practiceProcedure
  .errors({
    FORBIDDEN: { message: OWNER_ONLY },
    PLAN_REQUIRED: {
      message: "Доступно на тарифе «Про» — оплатите его в настройках",
    },
    LIMIT_REACHED: {
      message: `У практики может быть не больше ${MAX_WORKFLOWS} правил`,
    },
  })
  .input(workflowFormSchema.and(z.object({ practiceId: z.uuid() })))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();
    if (!(await hasPro(context.db, context.session.user.id))) {
      throw errors.PLAN_REQUIRED();
    }

    const { practiceId, ...rule } = input;
    // The practice row is locked, so two requests at the limit are counted
    // one after the other and only one of them gets the last place.
    return context.db.transaction(async (tx) => {
      await tx
        .select({ id: Practice.id })
        .from(Practice)
        .where(eq(Practice.id, practiceId))
        .for("update");
      const [existing] = await tx
        .select({ total: count() })
        .from(Workflow)
        .where(eq(Workflow.practiceId, practiceId));
      if ((existing?.total ?? 0) >= MAX_WORKFLOWS) {
        throw errors.LIMIT_REACHED();
      }

      const [created] = await tx
        .insert(Workflow)
        .values({ practiceId, ...rule })
        .returning({ id: Workflow.id });
      if (!created) throw new Error("Failed to insert workflow");
      return created;
    });
  });

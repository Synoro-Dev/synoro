import { eq, Workflow } from "@synoro/db";
import { workflowFormSchema } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import { protectedProcedure } from "../../orpc";
import { findOwnedWorkflow } from "./owner";

/**
 * Change a rule. Without «Про» a rule can only be switched off. Owner only.
 *
 * @example client.workflow.update({ id, trigger, amount, subject, text, active: false })
 */
export const update = protectedProcedure
  .errors({
    NOT_FOUND: { message: "Правило не найдено" },
    PLAN_REQUIRED: {
      message: "Доступно на тарифе «Про» — оплатите его в настройках",
    },
  })
  .input(workflowFormSchema.and(z.object({ id: z.uuid() })))
  .handler(async ({ context, input, errors }) => {
    const rule = await findOwnedWorkflow(
      context.db,
      input.id,
      context.session.user.id,
    );
    if (!rule) throw errors.NOT_FOUND();
    const pro = await hasPro(context.db, context.session.user.id);
    if (!pro && input.active) throw errors.PLAN_REQUIRED();

    const { id, ...changes } = input;
    await context.db
      .update(Workflow)
      // Without «Про» the rule is only switched off, never rewritten.
      .set(pro ? changes : { active: false })
      .where(eq(Workflow.id, id));
    return { id };
  });

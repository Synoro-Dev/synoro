import { eq, like, SentNotice, Workflow } from "@synoro/db";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";
import { findOwnedWorkflow } from "./owner";

/**
 * Delete a rule and the record of whom it mailed. Owner only.
 *
 * @example client.workflow.delete({ id })
 */
export const deleteWorkflow = protectedProcedure
  .errors({ NOT_FOUND: { message: "Правило не найдено" } })
  .input(z.object({ id: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const rule = await findOwnedWorkflow(
      context.db,
      input.id,
      context.session.user.id,
    );
    if (!rule) throw errors.NOT_FOUND();

    await context.db.delete(Workflow).where(eq(Workflow.id, rule.id));
    await context.db
      .delete(SentNotice)
      .where(like(SentNotice.key, `wf:${rule.id}:%`));
    return { id: rule.id };
  });

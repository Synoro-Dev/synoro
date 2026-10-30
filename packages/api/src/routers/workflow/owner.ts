import { type Database, eq, Workflow } from "@synoro/db";

import { findOwnerMembership } from "../../lib/practice-access";

/** Messages to clients are the owner's voice: administrators can't edit them. */
export const OWNER_ONLY = "Правила сообщений настраивает владелец практики";

/** The rule, if the user owns its practice. */
export async function findOwnedWorkflow(
  db: Database,
  id: string,
  userId: string,
) {
  const rule = await db.query.Workflow.findFirst({
    where: eq(Workflow.id, id),
  });
  const owner =
    rule && (await findOwnerMembership(db, rule.practiceId, userId));
  return owner ? rule : undefined;
}

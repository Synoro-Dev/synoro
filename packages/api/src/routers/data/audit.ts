import { DataAuditEntry, desc, eq, Practice, user } from "@synoro/db";

import { dataProcedure } from "../../lib/data-access";

/**
 * The journal of the caller's account: who took what out, brought it in or
 * asked to delete it. Latest 100 lines.
 *
 * @example client.data.audit()
 */
export const audit = dataProcedure.handler(({ context }) =>
  context.db
    .select({
      id: DataAuditEntry.id,
      action: DataAuditEntry.action,
      details: DataAuditEntry.details,
      createdAt: DataAuditEntry.createdAt,
      actorName: user.name,
      practiceName: Practice.name,
    })
    .from(DataAuditEntry)
    .leftJoin(user, eq(user.id, DataAuditEntry.actorId))
    .leftJoin(Practice, eq(Practice.id, DataAuditEntry.practiceId))
    .where(eq(DataAuditEntry.userId, context.session.user.id))
    .orderBy(desc(DataAuditEntry.createdAt))
    .limit(100),
);

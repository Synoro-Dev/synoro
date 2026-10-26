import { type Database, eq, user } from "@acme/db";

/** Read the current, verified email from the database rather than a cached session. */
export async function invitationRecipient(db: Database, userId: string) {
  const recipient = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { email: true, emailVerified: true },
  });
  return recipient?.emailVerified ? recipient.email.toLowerCase() : null;
}

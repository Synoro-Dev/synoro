import { account, and, type Database, eq } from "@synoro/db";
import { hashPassword, verifyPassword } from "better-auth/crypto";

export { hashPassword };

const PASSWORD_PROVIDER = "credential";

async function storedPassword(db: Database, userId: string) {
  const [row] = await db
    .select({ password: account.password })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, PASSWORD_PROVIDER),
      ),
    )
    .limit(1);
  return row?.password ?? null;
}

/** Whether the account has a password at all: most sign in by emailed code. */
export async function accountHasPassword(db: Database, userId: string) {
  return (await storedPassword(db, userId)) !== null;
}

/** Checks a password against Better Auth's hash, for re-confirming a person. */
export async function checkAccountPassword(
  db: Database,
  userId: string,
  password: string,
) {
  const hash = await storedPassword(db, userId);
  return hash ? verifyPassword({ hash, password }) : false;
}

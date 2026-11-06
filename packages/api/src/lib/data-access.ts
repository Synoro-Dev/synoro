import { createHash, randomInt } from "node:crypto";

import { DEMO_DOMAIN } from "@synoro/auth/demo";
import {
  and,
  type Database,
  desc,
  eq,
  gt,
  Practice,
  verification,
} from "@synoro/db";

import { protectedProcedure } from "../orpc";

/**
 * Taking a client base out of the service, or bringing one in, is more than an
 * ordinary action: the person has to prove again that it's them, and only the
 * practice's owner, in person, may do it.
 */

/** How long one confirmation lasts, per session. */
const ACCESS_MS = 15 * 60 * 1000;
/** The mail promises 10 minutes. */
const CODE_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const CODE_ATTEMPTS = 5;

interface DataSession {
  user: { email: string };
  session: { id: string; impersonatedBy?: string | null };
}

/** An admin signed in as someone, and demo visitors, take nothing out. */
export function mayTouchData(session: DataSession) {
  return (
    !session.session.impersonatedBy &&
    !session.user.email.toLowerCase().endsWith(DEMO_DOMAIN)
  );
}

/**
 * Procedures on the owner's data. Whether they own the practice in question,
 * and whether access is confirmed, the handlers check themselves.
 */
export const dataProcedure = protectedProcedure
  .errors({
    FORBIDDEN: { message: "Это может сделать только владелец практики" },
    ACCESS_REQUIRED: { message: "Подтвердите, что это вы" },
  })
  .use(({ context, next, errors }) => {
    if (!mayTouchData(context.session)) throw errors.FORBIDDEN();
    return next();
  });

function grantKey(sessionId: string) {
  return `data-access:${sessionId}`;
}

function codeKey(sessionId: string) {
  return `data-access-code:${sessionId}`;
}

function hashCode(sessionId: string, code: string) {
  return createHash("sha256").update(`${sessionId}:${code}`).digest("hex");
}

async function latest(db: Database, identifier: string) {
  const [row] = await db
    .select()
    .from(verification)
    .where(
      and(
        eq(verification.identifier, identifier),
        gt(verification.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(verification.createdAt))
    .limit(1);
  return row;
}

async function replace(
  db: Database,
  identifier: string,
  value: string,
  ms: number,
) {
  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier,
    value,
    expiresAt: new Date(Date.now() + ms),
  });
}

/** This session confirmed it's the owner in the last 15 minutes. */
export async function hasFreshAccess(db: Database, sessionId: string) {
  return (await latest(db, grantKey(sessionId))) !== undefined;
}

export async function grantAccess(db: Database, sessionId: string) {
  await replace(db, grantKey(sessionId), "granted", ACCESS_MS);
  await db
    .delete(verification)
    .where(eq(verification.identifier, codeKey(sessionId)));
}

/**
 * A new code to mail, or null if the last one went out under a minute ago.
 * Only its hash is kept, bound to the session that asked for it.
 */
export async function issueAccessCode(db: Database, sessionId: string) {
  const current = await latest(db, codeKey(sessionId));
  if (current && Date.now() - current.createdAt.getTime() < CODE_RESEND_MS) {
    return null;
  }
  const code = String(randomInt(100_000, 1_000_000));
  await replace(
    db,
    codeKey(sessionId),
    JSON.stringify({ hash: hashCode(sessionId, code), attempts: 0 }),
    CODE_MS,
  );
  return code;
}

/** Whether the code is right. Five wrong tries burn it. */
export async function checkAccessCode(
  db: Database,
  sessionId: string,
  code: string,
) {
  const current = await latest(db, codeKey(sessionId));
  if (!current) return false;
  const stored = JSON.parse(current.value) as {
    hash: string;
    attempts: number;
  };
  if (stored.hash === hashCode(sessionId, code)) return true;

  const attempts = stored.attempts + 1;
  if (attempts >= CODE_ATTEMPTS) {
    await db.delete(verification).where(eq(verification.id, current.id));
  } else {
    await db
      .update(verification)
      .set({ value: JSON.stringify({ ...stored, attempts }) })
      .where(eq(verification.id, current.id));
  }
  return false;
}

/** The practice if `userId` owns it. */
export function findOwnedPractice(
  db: Database,
  practiceId: string,
  userId: string,
) {
  return db.query.Practice.findFirst({
    where: and(eq(Practice.id, practiceId), eq(Practice.ownerId, userId)),
  });
}

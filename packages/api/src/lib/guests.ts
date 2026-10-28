import { createHash, randomBytes } from "node:crypto";

import { type Database, eq, PracticeMember, sql, user } from "@synoro/db";

import { findMembership } from "./practice-access";

/** A fresh secret for a visitor's `/b/<token>` link. */
export function newGuestToken() {
  return randomBytes(24).toString("base64url");
}

/** What the database keeps of a token: the link works, the table cannot leak it. */
export function hashGuestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The account and client membership of a visitor who books without signing
 * in. The account is found by email or created passive (email not verified,
 * no password): a visitor opens it later by asking for an emailed code, and
 * finds their bookings and balance there. Nothing is trusted from the form
 * beyond that — an existing account keeps its name and phone, an unverified
 * email proves nothing, and staff of the practice must sign in instead.
 *
 * `staff` is returned for the latter case, with nothing created.
 */
export async function findOrCreateGuestMember(
  db: Database,
  practiceId: string,
  guest: { name: string; email: string; phone: string },
) {
  const email = guest.email.trim().toLowerCase();
  const byEmail = () =>
    db.query.user.findFirst({ where: sql`lower(${user.email}) = ${email}` });

  let account = await byEmail();
  if (!account) {
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: guest.name,
        email,
        phone: guest.phone,
      })
      .onConflictDoNothing();
    account = await byEmail();
  } else if (!account.phone) {
    await db
      .update(user)
      .set({ phone: guest.phone })
      .where(eq(user.id, account.id));
  }
  if (!account) throw new Error("Failed to create the guest account");

  await db
    .insert(PracticeMember)
    .values({ practiceId, userId: account.id, role: "client" })
    .onConflictDoNothing();
  const member = await findMembership(db, practiceId, account.id);
  if (!member) throw new Error("Failed to create the guest membership");
  if (member.role !== "client") return { staff: true as const };

  return {
    staff: false as const,
    user: { id: account.id, email: account.email },
    memberId: member.id,
  };
}

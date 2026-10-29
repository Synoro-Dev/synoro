import {
  and,
  type Database,
  eq,
  type MemberRole,
  Practice,
  PracticeMember,
} from "@synoro/db";

import { protectedProcedure } from "../orpc";
import { hasPro } from "./billing";
import { practiceImageUrl } from "./urls";

/**
 * Signed-in procedure for practice-scoped calls. Handlers check membership
 * with the helpers below and throw `errors.FORBIDDEN()` themselves: the
 * practice id comes from the input, which middleware before `.input()`
 * can't see.
 */
export const practiceProcedure = protectedProcedure.errors({
  FORBIDDEN: { message: "Нет доступа к этой практике" },
});

/** Owner and administrators run the practice; clients only book. */
export function isStaff(role: MemberRole) {
  return role === "owner" || role === "admin";
}

export function findMembership(
  db: Database,
  practiceId: string,
  userId: string,
) {
  return db.query.PracticeMember.findFirst({
    where: and(
      eq(PracticeMember.practiceId, practiceId),
      eq(PracticeMember.userId, userId),
    ),
  });
}

/** The caller's membership if they are staff of the practice. */
export async function findStaffMembership(
  db: Database,
  practiceId: string,
  userId: string,
) {
  const member = await findMembership(db, practiceId, userId);
  return member && isStaff(member.role) ? member : undefined;
}

/** The caller's membership if they own the practice. */
export async function findOwnerMembership(
  db: Database,
  practiceId: string,
  userId: string,
) {
  const member = await findMembership(db, practiceId, userId);
  return member?.role === "owner" ? member : undefined;
}

/**
 * What a public booking page shows: practice info plus the caller's
 * membership (role, balance) when signed in. `showBadge` — the «Онлайн-запись
 * — Synoro» line at the bottom, shown while the owner has no «Про».
 */
export async function publicPractice(
  context: { db: Database; session: { user: { id: string } } | null },
  practiceId: string,
) {
  const practice = await context.db.query.Practice.findFirst({
    where: eq(Practice.id, practiceId),
    columns: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      profession: true,
      image: true,
      ownerId: true,
    },
  });
  if (!practice) return undefined;

  const userId = context.session?.user.id;
  const [member, pro] = await Promise.all([
    userId ? findMembership(context.db, practice.id, userId) : undefined,
    hasPro(context.db, practice.ownerId),
  ]);

  const { image, ownerId: _ownerId, ...info } = practice;
  return {
    ...info,
    imageUrl: practiceImageUrl(practice.slug, image),
    showBadge: !pro,
    membership: member
      ? { id: member.id, role: member.role, credits: member.credits }
      : null,
  };
}

export function findPractice(db: Database, practiceId: string) {
  return db.query.Practice.findFirst({ where: eq(Practice.id, practiceId) });
}

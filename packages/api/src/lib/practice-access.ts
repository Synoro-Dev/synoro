import {
  AccountDeletion,
  and,
  type Database,
  eq,
  type MemberRole,
  Practice,
  PracticeMember,
} from "@synoro/db";
import { DEFAULT_BOOKING_THEME, readBookingTheme } from "@synoro/validators";

import { protectedProcedure } from "../orpc";
import { hasPro } from "./billing";
import { acceptedVersions, currentDocuments } from "./consents";
import { activeServices } from "./services";
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
 * — Synoro» line at the bottom, shown while the owner has no «Про»;
 * `questions` — the booking questionnaire, asked only on «Про»;
 * `theme` — the page's look, the owner's own only on «Про»;
 * `freeBooking` — visitors may book the free intro themselves;
 * `introMinutes` — how long it lasts; `payAtVisit` — services are booked
 * without payment (`booking.bookAtVisit`), paid at the visit;
 * `cancelHours` / `lateCancel` — the practice's cancellation terms;
 * `documents` / `acceptsMinors` — what a client accepts when booking.
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
      bookingQuestions: true,
      bookingTheme: true,
      freeBookingEnabled: true,
      introMinutes: true,
      payAtVisit: true,
      cancelHours: true,
      lateCancel: true,
      acceptsMinors: true,
    },
  });
  if (!practice || (await ownerLeaving(context.db, practice.ownerId))) {
    return undefined;
  }

  const userId = context.session?.user.id;
  const [member, pro, services, documents] = await Promise.all([
    userId ? findMembership(context.db, practice.id, userId) : undefined,
    hasPro(context.db, practice.ownerId),
    activeServices(context.db, practice.id),
    currentDocuments(context.db, practice.id),
  ]);
  const accepted = await acceptedVersions(
    context.db,
    member?.id ?? null,
    documents.map((d) => d.versionId),
  );

  const {
    image,
    ownerId: _ownerId,
    bookingQuestions: questions,
    bookingTheme: theme,
    freeBookingEnabled: freeBooking,
    ...info
  } = practice;
  return {
    ...info,
    imageUrl: practiceImageUrl(practice.slug, image),
    showBadge: !pro,
    freeBooking,
    /**
     * What can be booked, in the order shown. Empty for a practice without
     * services: it books an hour for one credit.
     */
    services,
    /**
     * The documents a client accepts when booking, in the order shown (the
     * text is read with `document.read`); `accepted` / `acceptedForMinor` —
     * the caller did already, for themselves or as a parent. With
     * `acceptsMinors` the page offers booking for a child.
     */
    documents: documents.map((d) => ({
      id: d.id,
      versionId: d.versionId,
      kind: d.kind,
      title: d.title,
      required: d.required,
      accepted: accepted.self.has(d.versionId),
      acceptedForMinor: accepted.minor.has(d.versionId),
    })),
    /** The questionnaire to fill in when booking; empty without «Про». */
    questions: pro ? questions : [],
    /** How the page looks; the default look without «Про». */
    theme: pro ? readBookingTheme(theme) : DEFAULT_BOOKING_THEME,
    membership: member
      ? { id: member.id, role: member.role, credits: member.credits }
      : null,
  };
}

export function findPractice(db: Database, practiceId: string) {
  return db.query.Practice.findFirst({ where: eq(Practice.id, practiceId) });
}

async function ownerLeaving(db: Database, ownerId: string) {
  const [row] = await db
    .select({ userId: AccountDeletion.userId })
    .from(AccountDeletion)
    .where(eq(AccountDeletion.userId, ownerId))
    .limit(1);
  return row !== undefined;
}

/**
 * The practice if it takes bookings: not while its owner's account is being
 * deleted. Whoever books, pays or joins goes through this; staff looking after
 * what's already there use `findPractice`.
 */
export async function findOpenPractice(db: Database, practiceId: string) {
  const practice = await findPractice(db, practiceId);
  if (!practice || (await ownerLeaving(db, practice.ownerId))) return undefined;
  return practice;
}

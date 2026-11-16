import {
  and,
  Consent,
  type Database,
  desc,
  eq,
  inArray,
  PracticeDocument,
  PracticeDocumentVersion,
  PracticeMember,
} from "@synoro/db";
import type { ConsentsInput } from "@synoro/validators";
import { z } from "zod";

import { clientIp } from "./rate-limit";

/**
 * The practice's documents in force, in the order shown: each with its
 * latest version. Archived ones are asked of nobody.
 */
export async function currentDocuments(db: Database, practiceId: string) {
  const rows = await db
    .selectDistinctOn([PracticeDocument.id], {
      id: PracticeDocument.id,
      kind: PracticeDocument.kind,
      required: PracticeDocument.required,
      position: PracticeDocument.position,
      createdAt: PracticeDocument.createdAt,
      versionId: PracticeDocumentVersion.id,
      number: PracticeDocumentVersion.number,
      title: PracticeDocumentVersion.title,
      body: PracticeDocumentVersion.body,
      publishedAt: PracticeDocumentVersion.createdAt,
    })
    .from(PracticeDocument)
    .innerJoin(
      PracticeDocumentVersion,
      eq(PracticeDocumentVersion.documentId, PracticeDocument.id),
    )
    .where(
      and(
        eq(PracticeDocument.practiceId, practiceId),
        eq(PracticeDocument.archived, false),
      ),
    )
    .orderBy(PracticeDocument.id, desc(PracticeDocumentVersion.number));
  return rows.sort(
    (a, b) =>
      a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** A child's name as compared: «  Миша » and «миша» are one child. */
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Which of `versionIds` the member has accepted already, signed in: for
 * themselves, or — with `minorName` — as a parent for that child. The two
 * don't stand in for each other, nor does one child's consent for another's.
 * Consents given without signing in don't count (`consents.by_session`).
 */
export async function acceptedVersions(
  db: Database,
  memberId: string | null,
  versionIds: string[],
  minorName?: string,
) {
  const accepted = new Set<string>();
  if (!memberId || versionIds.length === 0) return accepted;
  const rows = await db
    .select({
      versionId: Consent.versionId,
      representativeName: Consent.representativeName,
      minorName: Consent.minorName,
    })
    .from(Consent)
    .where(
      and(
        eq(Consent.memberId, memberId),
        eq(Consent.bySession, true),
        inArray(Consent.versionId, versionIds),
      ),
    );
  for (const row of rows) {
    const forChild = row.representativeName !== null;
    if (minorName === undefined) {
      if (!forChild) accepted.add(row.versionId);
    } else if (
      forChild &&
      row.minorName !== null &&
      nameKey(row.minorName) === nameKey(minorName)
    ) {
      accepted.add(row.versionId);
    }
  }
  return accepted;
}

/** The client of `practiceId` behind a session, if they are one already. */
export async function sessionMemberId(
  db: Database,
  practiceId: string,
  session: { user: { id: string } } | null,
) {
  if (!session) return null;
  // Not `findMembership`: `practice-access` reads documents from here.
  const [member] = await db
    .select({ id: PracticeMember.id })
    .from(PracticeMember)
    .where(
      and(
        eq(PracticeMember.practiceId, practiceId),
        eq(PracticeMember.userId, session.user.id),
      ),
    );
  return member?.id ?? null;
}

/**
 * Whether a client booking for themselves has accepted what the practice
 * asks: `missing` — the required documents neither ticked now (`input`) nor
 * accepted before; `accept` — what to record once the booking exists
 * (`recordConsents`). `memberId` null — a visitor not known yet: everything
 * required must be ticked. Booking for a child (`input.minor`, only where the
 * practice takes minors) needs the parent's consent for that child, whatever
 * they accepted for themselves or for another child.
 */
export async function checkConsents(
  db: Database,
  practice: { id: string; acceptsMinors: boolean },
  memberId: string | null,
  input: ConsentsInput,
) {
  const documents = await currentDocuments(db, practice.id);
  const minor = practice.acceptsMinors ? input?.minor : undefined;
  const given = new Set(input?.versionIds ?? []);
  const satisfied = await acceptedVersions(
    db,
    memberId,
    documents.map((d) => d.versionId),
    minor?.minorName,
  );
  return {
    missing: documents
      .filter(
        (d) =>
          d.required && !given.has(d.versionId) && !satisfied.has(d.versionId),
      )
      .map((d) => d.id),
    accept: {
      versionIds: documents
        .filter((d) => given.has(d.versionId))
        .map((d) => d.versionId),
      minor,
    },
  };
}

export type ConsentsToRecord = Awaited<
  ReturnType<typeof checkConsents>
>["accept"];

/**
 * Write down the consents a booking was made with: the versions ticked, with
 * the moment, the address and the browser. `bySession`: the member was signed
 * in; then a version they already accepted in this capacity isn't written
 * again. A visitor's consents are always written: each booking keeps its own
 * proof, and none of them counts for the member (`acceptedVersions`).
 */
export async function recordConsents(
  db: Database,
  input: {
    practiceId: string;
    memberId: string;
    bookingId: string;
    accept: ConsentsToRecord;
    headers: Headers;
    bySession: boolean;
  },
) {
  const { versionIds, minor } = input.accept;
  if (versionIds.length === 0) return;
  const satisfied = input.bySession
    ? await acceptedVersions(db, input.memberId, versionIds, minor?.minorName)
    : new Set<string>();
  const fresh = versionIds.filter((id) => !satisfied.has(id));
  if (fresh.length === 0) return;
  await db.insert(Consent).values(
    fresh.map((versionId) => ({
      practiceId: input.practiceId,
      memberId: input.memberId,
      versionId,
      bookingId: input.bookingId,
      bySession: input.bySession,
      ip: clientIp(input.headers),
      userAgent: input.headers.get("user-agent")?.slice(0, 300) ?? null,
      representativeName: minor?.representativeName ?? null,
      minorName: minor?.minorName ?? null,
    })),
  );
}

/** The error the booking procedures raise for documents left unaccepted. */
export const CONSENTS_REQUIRED = {
  message: "Примите документы специалиста, чтобы записаться",
  /** The documents still to accept, by id. */
  data: z.object({ documentIds: z.array(z.string()) }),
};

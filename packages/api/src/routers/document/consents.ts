import {
  and,
  Consent,
  desc,
  eq,
  PracticeDocument,
  PracticeDocumentVersion,
} from "@synoro/db";
import { z } from "zod";

import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * What one client has accepted, newest first: the document and its version,
 * when, and — for a child — who consented for whom. The address and browser
 * are kept as proof and go out with the data archive; the card doesn't show
 * them. Staff only.
 *
 * @example client.document.consents({ practiceId, memberId })
 */
export const consents = practiceProcedure
  .input(z.object({ practiceId: z.uuid(), memberId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const staff = await findStaffMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    return context.db
      .select({
        id: Consent.id,
        versionId: Consent.versionId,
        kind: PracticeDocument.kind,
        title: PracticeDocumentVersion.title,
        version: PracticeDocumentVersion.number,
        acceptedAt: Consent.acceptedAt,
        representativeName: Consent.representativeName,
        minorName: Consent.minorName,
      })
      .from(Consent)
      .innerJoin(
        PracticeDocumentVersion,
        eq(PracticeDocumentVersion.id, Consent.versionId),
      )
      .innerJoin(
        PracticeDocument,
        eq(PracticeDocument.id, PracticeDocumentVersion.documentId),
      )
      .where(
        and(
          eq(Consent.practiceId, input.practiceId),
          eq(Consent.memberId, input.memberId),
        ),
      )
      .orderBy(desc(Consent.acceptedAt), desc(Consent.id));
  });

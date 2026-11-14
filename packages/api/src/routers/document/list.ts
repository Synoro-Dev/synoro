import { Consent, count, eq, inArray, Practice } from "@synoro/db";
import { z } from "zod";

import { currentDocuments } from "../../lib/consents";
import {
  findStaffMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * The practice's documents with the wording in force, in the order clients
 * see them, each with how many consents its current version has; and whether
 * the practice takes clients under 18. Staff read them, the owner edits
 * (`document.save`).
 *
 * @example client.document.list({ practiceId })
 */
export const list = practiceProcedure
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { db } = context;
    const staff = await findStaffMembership(
      db,
      input.practiceId,
      context.session.user.id,
    );
    if (!staff) throw errors.FORBIDDEN();

    const [documents, [practice]] = await Promise.all([
      currentDocuments(db, input.practiceId),
      db
        .select({ acceptsMinors: Practice.acceptsMinors })
        .from(Practice)
        .where(eq(Practice.id, input.practiceId)),
    ]);
    const versionIds = documents.map((d) => d.versionId);
    const counts =
      versionIds.length === 0
        ? []
        : await db
            .select({ versionId: Consent.versionId, n: count() })
            .from(Consent)
            .where(inArray(Consent.versionId, versionIds))
            .groupBy(Consent.versionId);
    const accepted = new Map(counts.map((row) => [row.versionId, row.n]));

    return {
      acceptsMinors: practice?.acceptsMinors ?? false,
      documents: documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        required: d.required,
        title: d.title,
        body: d.body,
        /** The version in force: 1 for a document never changed. */
        version: d.number,
        publishedAt: d.publishedAt,
        /** Consents given to this version. */
        accepted: accepted.get(d.versionId) ?? 0,
      })),
    };
  });

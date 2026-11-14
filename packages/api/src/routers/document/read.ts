import {
  eq,
  Practice,
  PracticeDocument,
  PracticeDocumentVersion,
} from "@synoro/db";
import { z } from "zod";

import { publicProcedure } from "../../orpc";

/**
 * One version of a practice's document, to read before accepting it — and
 * after: a version stays readable by its id, also once a newer one replaced
 * it or the document was archived. Public: a client reads it before signing
 * in, and the text is the specialist's public offer anyway.
 *
 * @example client.document.read({ versionId })
 */
export const read = publicProcedure
  .errors({ NOT_FOUND: { message: "Документ не найден" } })
  .input(z.object({ versionId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const [row] = await context.db
      .select({
        kind: PracticeDocument.kind,
        title: PracticeDocumentVersion.title,
        body: PracticeDocumentVersion.body,
        version: PracticeDocumentVersion.number,
        publishedAt: PracticeDocumentVersion.createdAt,
        practiceName: Practice.name,
      })
      .from(PracticeDocumentVersion)
      .innerJoin(
        PracticeDocument,
        eq(PracticeDocument.id, PracticeDocumentVersion.documentId),
      )
      .innerJoin(Practice, eq(Practice.id, PracticeDocument.practiceId))
      .where(eq(PracticeDocumentVersion.id, input.versionId));
    if (!row) throw errors.NOT_FOUND();
    return row;
  });

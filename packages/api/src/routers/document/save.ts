import {
  and,
  eq,
  Practice,
  PracticeDocument,
  PracticeDocumentVersion,
  sql,
} from "@synoro/db";
import { documentsFormSchema } from "@synoro/validators";
import { z } from "zod";

import { currentDocuments } from "../../lib/consents";
import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";

/**
 * Replace the practice's documents, in the order given, and say whether it
 * takes clients under 18. A document with an `id` is changed in place: a new
 * title or text becomes a new version, and clients are asked to accept it at
 * their next booking; the same wording stays the same version. One without an
 * `id` is new. A document left out is archived, never deleted: consents given
 * to it must stay provable. Saves of one practice run one at a time. Returns
 * the id of every document, in the order given, so a client that sent new ones
 * can name them in its next save. Owner only.
 *
 * @example client.document.save({ practiceId, acceptsMinors: false, documents: [{ kind: "offer", title: "Договор-оферта", body: "…", required: true }] })
 */
export const save = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Документы настраивает владелец практики" },
  })
  .input(documentsFormSchema.extend({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const ids = await context.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`documents:${input.practiceId}`}))`,
      );
      const existing = await currentDocuments(tx, input.practiceId);
      const known = new Map(existing.map((d) => [d.id, d]));
      const kept = new Set<string>();
      /** The id of each document, in the order given. */
      const ids: string[] = [];

      for (const [position, document] of input.documents.entries()) {
        const current = document.id ? known.get(document.id) : undefined;
        if (current) {
          kept.add(current.id);
          ids.push(current.id);
          await tx
            .update(PracticeDocument)
            .set({
              kind: document.kind,
              required: document.required,
              position,
            })
            .where(eq(PracticeDocument.id, current.id));
          if (
            current.title !== document.title ||
            current.body !== document.body
          ) {
            await tx.insert(PracticeDocumentVersion).values({
              documentId: current.id,
              number: current.number + 1,
              title: document.title,
              body: document.body,
            });
          }
          continue;
        }
        const [created] = await tx
          .insert(PracticeDocument)
          .values({
            practiceId: input.practiceId,
            kind: document.kind,
            required: document.required,
            position,
          })
          .returning({ id: PracticeDocument.id });
        if (!created) throw new Error("Failed to insert document");
        ids.push(created.id);
        await tx.insert(PracticeDocumentVersion).values({
          documentId: created.id,
          number: 1,
          title: document.title,
          body: document.body,
        });
      }

      for (const { id } of existing.filter((d) => !kept.has(d.id))) {
        await tx
          .update(PracticeDocument)
          .set({ archived: true })
          .where(
            and(
              eq(PracticeDocument.id, id),
              eq(PracticeDocument.practiceId, input.practiceId),
            ),
          );
      }
      await tx
        .update(Practice)
        .set({ acceptsMinors: input.acceptsMinors })
        .where(eq(Practice.id, input.practiceId));
      return ids;
    });

    return { saved: ids.length, ids };
  });

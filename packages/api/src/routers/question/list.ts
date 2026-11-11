import { eq, Practice } from "@synoro/db";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { OWNER_ONLY } from "./owner";

/**
 * The practice's questionnaire and whether its owner can use it (questions
 * of an owner without «Про» are kept but not asked). Owner only.
 *
 * @example client.question.list({ practiceId })
 */
export const list = practiceProcedure
  .errors({ FORBIDDEN: { message: OWNER_ONLY } })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    const [pro, practice] = await Promise.all([
      hasPro(context.db, context.session.user.id),
      context.db.query.Practice.findFirst({
        where: eq(Practice.id, input.practiceId),
        columns: { bookingQuestions: true },
      }),
    ]);
    return { pro, questions: practice?.bookingQuestions ?? [] };
  });

import { eq, Practice } from "@synoro/db";
import { bookingQuestionsSchema } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findOwnerMembership,
  practiceProcedure,
} from "../../lib/practice-access";
import { OWNER_ONLY } from "./owner";

/**
 * Replace the questionnaire clients fill in when booking — «Про» only,
 * though anyone may clear it. Answers already given stay on their bookings
 * with the wording they were asked. Owner only.
 *
 * @example client.question.save({ practiceId, questions: [{ id, label: "С чем хотите прийти?", kind: "long_text", options: [], required: true }] })
 */
export const save = practiceProcedure
  .errors({
    FORBIDDEN: { message: OWNER_ONLY },
    PLAN_REQUIRED: {
      message: "Доступно на тарифе «Про» — оплатите его в настройках",
    },
  })
  .input(z.object({ practiceId: z.uuid(), questions: bookingQuestionsSchema }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();
    if (
      input.questions.length > 0 &&
      !(await hasPro(context.db, context.session.user.id))
    ) {
      throw errors.PLAN_REQUIRED();
    }

    await context.db
      .update(Practice)
      .set({ bookingQuestions: input.questions })
      .where(eq(Practice.id, input.practiceId));
    return { questions: input.questions };
  });

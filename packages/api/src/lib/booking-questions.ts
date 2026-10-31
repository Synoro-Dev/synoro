import type { Database } from "@synoro/db";
import {
  type BookingAnswersInput,
  type BookingQuestion,
  checkBookingAnswers,
} from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "./billing";

type QuestionnaireOwner = {
  ownerId: string;
  bookingQuestions: BookingQuestion[];
};

/**
 * The questions a client of `practice` is asked when booking: its
 * questionnaire while the owner has «Про», none otherwise.
 */
async function askedQuestions(
  db: Database,
  practice: QuestionnaireOwner,
): Promise<BookingQuestion[]> {
  if (practice.bookingQuestions.length === 0) return [];
  return (await hasPro(db, practice.ownerId)) ? practice.bookingQuestions : [];
}

/**
 * The answers to keep on a booking the client makes for themselves (null
 * when nothing was asked or answered), or the errors per question id.
 */
export async function bookingAnswers(
  db: Database,
  practice: QuestionnaireOwner,
  input: BookingAnswersInput,
) {
  const questions = await askedQuestions(db, practice);
  const { answers, errors } = checkBookingAnswers(questions, input);
  return {
    answers: answers.length > 0 ? answers : null,
    errors: Object.keys(errors).length > 0 ? errors : null,
  };
}

/** The error the booking procedures raise for a questionnaire left unfilled. */
export const ANSWERS_INVALID = {
  message: "Ответьте на вопросы анкеты",
  /** An error per question id, shown next to its field. */
  data: z.object({ errors: z.record(z.string(), z.string()) }),
};

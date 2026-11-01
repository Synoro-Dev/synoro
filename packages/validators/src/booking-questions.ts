import { z } from "zod";

/**
 * Questions a client answers when booking, on «Про» («Booking questions» in
 * cal.com): what brings them, how they found the specialist, a choice of
 * format.
 *
 * text      — one line, up to `ANSWER_MAX.text` characters;
 * long_text — a paragraph, up to `ANSWER_MAX.long_text`;
 * choice    — one of the question's `options`.
 */
export const BOOKING_QUESTION_KINDS = ["text", "long_text", "choice"] as const;

export type BookingQuestionKind = (typeof BOOKING_QUESTION_KINDS)[number];

export const BOOKING_QUESTION_KIND_LABELS: Record<BookingQuestionKind, string> =
  {
    text: "Строка",
    long_text: "Абзац",
    choice: "Выбор варианта",
  };

/** How many questions one practice can ask. */
export const MAX_BOOKING_QUESTIONS = 10;

/** How many options a `choice` question can offer. */
export const MAX_QUESTION_OPTIONS = 10;

/** The longest answer each kind takes. */
export const ANSWER_MAX: Record<BookingQuestionKind, number> = {
  text: 200,
  long_text: 2000,
  choice: 100,
};

export const bookingQuestionSchema = z
  .object({
    /** Made by the editor; answers are sent keyed by it. */
    id: z.uuid(),
    label: z
      .string()
      .trim()
      .min(1, "Напишите вопрос")
      .max(200, "Вопрос не должен быть длиннее 200 символов"),
    kind: z.enum(BOOKING_QUESTION_KINDS),
    /** Choices of a `choice` question; empty for the other kinds. */
    options: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Вариант не может быть пустым")
          .max(ANSWER_MAX.choice, "Вариант слишком длинный"),
      )
      .max(MAX_QUESTION_OPTIONS, `Не больше ${MAX_QUESTION_OPTIONS} вариантов`),
    required: z.boolean(),
  })
  .superRefine((question, ctx) => {
    if (question.kind !== "choice") {
      if (question.options.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "Варианты бывают только у вопроса с выбором",
        });
      }
      return;
    }
    if (question.options.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `«${question.label}»: нужно хотя бы два варианта`,
      });
    }
    if (new Set(question.options).size !== question.options.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `«${question.label}»: варианты повторяются`,
      });
    }
  });

export type BookingQuestion = z.infer<typeof bookingQuestionSchema>;

/** The whole questionnaire, saved at once in the order shown. */
export const bookingQuestionsSchema = z
  .array(bookingQuestionSchema)
  .max(
    MAX_BOOKING_QUESTIONS,
    `Не больше ${MAX_BOOKING_QUESTIONS} вопросов в анкете`,
  )
  .refine(
    (questions) =>
      new Set(questions.map((q) => q.id)).size === questions.length,
    "Вопросы повторяются",
  );

/** What the client sends: answers keyed by question id. */
export const bookingAnswersInput = z
  .record(z.string(), z.string().max(ANSWER_MAX.long_text))
  .optional();

export type BookingAnswersInput = z.infer<typeof bookingAnswersInput>;

/**
 * An answer as kept on the booking: the question's wording at booking time,
 * so later edits of the questionnaire don't change what the client answered.
 */
export interface BookingAnswer {
  question: string;
  answer: string;
}

/**
 * Check `answers` against `questions`: required ones answered, choices from
 * the list, lengths in range. Returns the answers to keep (in question
 * order, blanks left out) and an error per question id that failed; unknown
 * ids are ignored.
 */
export function checkBookingAnswers(
  questions: readonly BookingQuestion[],
  answers: Record<string, string> = {},
) {
  const kept: BookingAnswer[] = [];
  const errors: Record<string, string> = {};
  for (const question of questions) {
    const answer = (answers[question.id] ?? "").trim();
    if (answer === "") {
      if (question.required) errors[question.id] = "Ответьте на вопрос";
      continue;
    }
    if (question.kind === "choice" && !question.options.includes(answer)) {
      errors[question.id] = "Выберите вариант из списка";
      continue;
    }
    const max = ANSWER_MAX[question.kind];
    if (answer.length > max) {
      errors[question.id] = `Не больше ${max} символов`;
      continue;
    }
    kept.push({ question: question.label, answer });
  }
  return { answers: kept, errors };
}

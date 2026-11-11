"use client";

import {
  Button,
  FieldLabel,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from "@synoro/ui";
import { ANSWER_MAX, type BookingQuestion } from "@synoro/validators";

/**
 * The practice's questionnaire on the booking page («Про»): a field per
 * question, an error under each one `checkBookingAnswers` rejected.
 */
export function BookingQuestionFields({
  questions,
  values,
  errors,
  onChange,
  idPrefix,
}: {
  questions: BookingQuestion[];
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  idPrefix: string;
}) {
  const set = (id: string, value: string) =>
    onChange({ ...values, [id]: value });

  return (
    <div className="flex flex-col gap-4">
      {questions.map((question) => {
        const id = `${idPrefix}-${question.id}`;
        const error = errors[question.id];
        const value = values[question.id] ?? "";
        const label = (
          <>
            {question.label}
            {!question.required && (
              <span className="font-normal text-muted-foreground">
                необязательно
              </span>
            )}
          </>
        );
        const described = error ? `${id}-error` : undefined;
        return (
          <div key={question.id} className="flex flex-col gap-1.5">
            {question.kind === "choice" ? (
              <>
                <span
                  id={`${id}-label`}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium"
                >
                  {label}
                </span>
                <RadioGroup
                  value={value}
                  onValueChange={(next) => set(question.id, String(next))}
                  aria-labelledby={`${id}-label`}
                  aria-invalid={!!error}
                  aria-describedby={described}
                  className="gap-1.5"
                >
                  {question.options.map((option) => (
                    <FieldLabel
                      key={option}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 font-normal transition-colors hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5 dark:has-data-checked:bg-primary/10"
                    >
                      <RadioGroupItem value={option} />
                      <span className="min-w-0 break-words">{option}</span>
                    </FieldLabel>
                  ))}
                </RadioGroup>
                {!question.required && value !== "" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="-ml-2 self-start text-muted-foreground"
                    onClick={() => set(question.id, "")}
                  >
                    Сбросить выбор
                  </Button>
                )}
              </>
            ) : (
              <>
                <Label
                  htmlFor={id}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  {label}
                </Label>
                {question.kind === "long_text" ? (
                  <Textarea
                    id={id}
                    rows={3}
                    maxLength={ANSWER_MAX.long_text}
                    value={value}
                    aria-invalid={!!error}
                    aria-describedby={described}
                    onChange={(e) => set(question.id, e.target.value)}
                  />
                ) : (
                  <Input
                    id={id}
                    maxLength={ANSWER_MAX.text}
                    value={value}
                    aria-invalid={!!error}
                    aria-describedby={described}
                    onChange={(e) => set(question.id, e.target.value)}
                  />
                )}
              </>
            )}
            {error && (
              <p
                id={`${id}-error`}
                role="alert"
                className="text-xs text-destructive"
              >
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

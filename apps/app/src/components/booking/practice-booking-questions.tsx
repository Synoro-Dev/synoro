"use client";

import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  BOOKING_QUESTION_KIND_LABELS,
  BOOKING_QUESTION_KINDS,
  type BookingQuestion,
  type BookingQuestionKind,
  bookingQuestionsSchema,
  MAX_BOOKING_QUESTIONS,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ProRequired } from "../billing/pro-required";
import { SaveState } from "../settings/save-state";
import { ErrorState } from "./states";

/** A question being edited: choices as text, one per line. */
type Draft = Omit<BookingQuestion, "options"> & { optionsText: string };

const toDraft = (q: BookingQuestion): Draft => ({
  id: q.id,
  label: q.label,
  kind: q.kind,
  required: q.required,
  optionsText: q.options.join("\n"),
});

const fromDraft = ({ optionsText, ...q }: Draft): BookingQuestion => ({
  ...q,
  options:
    q.kind === "choice"
      ? optionsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [],
});

const SAMPLES: Omit<BookingQuestion, "id">[] = [
  {
    label: "С каким запросом хотите прийти?",
    kind: "long_text",
    options: [],
    required: true,
  },
  {
    label: "Как вы обо мне узнали?",
    kind: "choice",
    options: ["Посоветовали", "Соцсети", "Поиск", "Другое"],
    required: false,
  },
];

/**
 * The questionnaire clients fill in when booking («Про», cal.com's «Booking
 * questions»): the owner adds, orders and words up to ten questions and saves
 * them at once. Answers show up on the booking in the calendar.
 */
export function PracticeBookingQuestions({
  practiceId,
}: {
  practiceId: string;
}) {
  const settings = useQuery(
    orpc.question.list.queryOptions({ input: { practiceId } }),
  );

  if (settings.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (settings.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить анкету."
        onRetry={() => settings.refetch()}
      />
    );
  }
  return (
    <Editor
      practiceId={practiceId}
      pro={settings.data.pro}
      saved={settings.data.questions}
    />
  );
}

function Editor({
  practiceId,
  pro,
  saved,
}: {
  practiceId: string;
  pro: boolean;
  saved: BookingQuestion[];
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => saved.map(toDraft));
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = useMutation({
    ...orpc.question.save.mutationOptions(),
    onSuccess: async ({ questions }) => {
      setSavedAt(Date.now());
      toast.success(
        questions.length > 0 ? "Анкета сохранена" : "Анкета выключена",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.question.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (e) => toast.error(e.message),
  });

  const changed =
    JSON.stringify(drafts.map(fromDraft)) !== JSON.stringify(saved);
  const full = drafts.length >= MAX_BOOKING_QUESTIONS;
  // Without «Про» questions can only be removed.
  const canSave = changed && (pro || drafts.length === 0);

  function patch(id: string, change: Partial<Draft>) {
    setDrafts(drafts.map((d) => (d.id === id ? { ...d, ...change } : d)));
    setError(undefined);
  }

  function move(index: number, by: -1 | 1) {
    const next = [...drafts];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + by, 0, item);
    setDrafts(next);
  }

  function add(sample?: Omit<BookingQuestion, "id">) {
    setDrafts([
      ...drafts,
      toDraft({
        id: crypto.randomUUID(),
        ...(sample ?? {
          label: "",
          kind: "text",
          options: [],
          required: false,
        }),
      }),
    ]);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = bookingQuestionsSchema.safeParse(drafts.map(fromDraft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте вопросы");
      return;
    }
    setError(undefined);
    const sent = drafts;
    save.mutate(
      { practiceId, questions: parsed.data },
      {
        // Show what was stored, unless the owner kept editing meanwhile.
        onSuccess: ({ questions }) =>
          setDrafts((current) =>
            current === sent ? questions.map(toDraft) : current,
          ),
      },
    );
  }

  return (
    <FramePanel>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle className="flex flex-wrap items-center gap-2">
            Анкета перед записью
            {saved.length > 0 && (
              <Badge variant={pro ? "success-light" : "warning-light"}>
                {pro ? "Включена" : "Не задаётся без «Про»"}
              </Badge>
            )}
          </FrameTitle>
          <FrameDescription>
            Клиент ответит при записи, ответы появятся в записи в календаре.
            Изменения не трогают уже полученные ответы.
          </FrameDescription>
        </FrameHeader>

        {pro ? null : <ProRequired feature="Анкета перед записью" />}

        {drafts.length === 0 ? (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <span>Вопросов пока нет. Можно начать с заготовки:</span>
            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((sample) => (
                <Button
                  key={sample.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!pro}
                  onClick={() => add(sample)}
                >
                  <PlusIcon />
                  {sample.label}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col divide-y rounded-md border">
            {drafts.map((draft, index) => (
              <li key={draft.id} className="flex flex-col gap-3 p-3">
                <div className="flex items-start gap-2">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel htmlFor={`question-${draft.id}`}>
                      Вопрос {index + 1}
                    </FieldLabel>
                    <Input
                      id={`question-${draft.id}`}
                      maxLength={200}
                      placeholder="Например: с чем хотите прийти?"
                      value={draft.label}
                      disabled={!pro}
                      onChange={(e) =>
                        patch(draft.id, { label: e.target.value })
                      }
                    />
                  </Field>
                  <div className="flex gap-1 pt-6">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Выше"
                      disabled={!pro || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Ниже"
                      disabled={!pro || index === drafts.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Удалить вопрос"
                      onClick={() =>
                        setDrafts(drafts.filter((d) => d.id !== draft.id))
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <Select
                    items={BOOKING_QUESTION_KIND_LABELS}
                    value={draft.kind}
                    disabled={!pro}
                    onValueChange={(kind) =>
                      patch(draft.id, { kind: kind as BookingQuestionKind })
                    }
                  >
                    <SelectTrigger className="w-48" aria-label="Тип ответа">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BOOKING_QUESTION_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {BOOKING_QUESTION_KIND_LABELS[kind]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Field orientation="horizontal" className="w-auto">
                    <Switch
                      id={`question-required-${draft.id}`}
                      checked={draft.required}
                      disabled={!pro}
                      onCheckedChange={(required) =>
                        patch(draft.id, { required })
                      }
                    />
                    <FieldLabel
                      htmlFor={`question-required-${draft.id}`}
                      className="font-normal"
                    >
                      Обязательный
                    </FieldLabel>
                  </Field>
                </div>

                {draft.kind === "choice" && (
                  <Field>
                    <FieldLabel htmlFor={`question-options-${draft.id}`}>
                      Варианты ответа
                    </FieldLabel>
                    <Textarea
                      id={`question-options-${draft.id}`}
                      rows={4}
                      placeholder={"Онлайн\nВ кабинете"}
                      value={draft.optionsText}
                      disabled={!pro}
                      onChange={(e) =>
                        patch(draft.id, { optionsText: e.target.value })
                      }
                    />
                    <FieldDescription>
                      По одному в строке, от двух до десяти
                    </FieldDescription>
                  </Field>
                )}
              </li>
            ))}
          </ol>
        )}

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex flex-wrap items-center gap-2">
          {drafts.length > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={!pro || full}
              onClick={() => add()}
            >
              <PlusIcon />
              Добавить вопрос
            </Button>
          )}
          <Button type="submit" disabled={!canSave || save.isPending}>
            Сохранить анкету
          </Button>
          <SaveState dirty={changed} savedAt={savedAt} />
          {full && (
            <span className="text-xs text-muted-foreground">
              Не больше {MAX_BOOKING_QUESTIONS} вопросов
            </span>
          )}
        </div>
      </form>
    </FramePanel>
  );
}

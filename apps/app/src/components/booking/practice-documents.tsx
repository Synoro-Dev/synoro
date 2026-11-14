"use client";

import type { RouterOutputs } from "@synoro/api";
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
  DOCUMENT_BODY_MAX,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DOCUMENT_TITLE_MAX,
  DOCUMENTS_MAX,
  type DocumentKind,
  documentsFormSchema,
  pluralize,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ErrorState } from "~/components/booking/states";
import { SaveState } from "~/components/settings/save-state";
import { orpc } from "~/orpc/react";

type Saved = RouterOutputs["document"]["list"];

/** A document being edited; `key` also names the ones not saved yet. */
interface Draft {
  key: string;
  id?: string;
  kind: DocumentKind;
  title: string;
  body: string;
  required: boolean;
}

const toDrafts = (saved: Saved): Draft[] =>
  saved.documents.map((d) => ({
    key: d.id,
    id: d.id,
    kind: d.kind,
    title: d.title,
    body: d.body,
    required: d.required,
  }));

/** What goes to the server, and what «changed» compares. */
const toInput = (drafts: Draft[]) =>
  drafts.map(({ key: _, ...d }) => ({
    ...d,
    title: d.title.trim(),
    body: d.body.trim(),
  }));

/**
 * The documents a client accepts when booking: the owner words up to five —
 * an offer, informed consent, consent to processing personal data — orders
 * them and saves them at once. A changed text is a new version, asked of
 * every client again; who accepted what is in the client's card.
 */
export function PracticeDocuments({ practiceId }: { practiceId: string }) {
  const settings = useQuery(
    orpc.document.list.queryOptions({ input: { practiceId } }),
  );

  if (settings.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (settings.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить документы."
        onRetry={() => settings.refetch()}
      />
    );
  }
  return <Editor practiceId={practiceId} saved={settings.data} />;
}

function Editor({ practiceId, saved }: { practiceId: string; saved: Saved }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => toDrafts(saved));
  const [minors, setMinors] = useState(saved.acceptsMinors);
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // After a save the list is refetched: show the stored ids and versions,
  // unless the owner kept editing meanwhile.
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    if (
      JSON.stringify(toInput(drafts).map(({ id: _, ...d }) => d)) ===
      JSON.stringify(toInput(toDrafts(saved)).map(({ id: _, ...d }) => d))
    ) {
      setDrafts(toDrafts(saved));
    }
  }

  const save = useMutation({
    ...orpc.document.save.mutationOptions(),
    onSuccess: async ({ saved: count }) => {
      setSavedAt(Date.now());
      toast.success(
        count > 0 ? "Документы сохранены" : "Документы больше не запрашиваются",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.document.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (e) => toast.error(e.message),
  });

  const changed =
    minors !== saved.acceptsMinors ||
    JSON.stringify(toInput(drafts)) !==
      JSON.stringify(toInput(toDrafts(saved)));
  const full = drafts.length >= DOCUMENTS_MAX;
  const versions = new Map(saved.documents.map((d) => [d.id, d]));

  function patch(key: string, change: Partial<Draft>) {
    setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...change } : d)));
    setError(undefined);
  }

  function move(index: number, by: -1 | 1) {
    const next = [...drafts];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + by, 0, item);
    setDrafts(next);
  }

  function add(kind: DocumentKind) {
    setDrafts([
      ...drafts,
      {
        key: crypto.randomUUID(),
        kind,
        title: kind === "other" ? "" : DOCUMENT_KIND_LABELS[kind],
        body: "",
        required: true,
      },
    ]);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = documentsFormSchema.safeParse({
      documents: toInput(drafts),
      acceptsMinors: minors,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте документы");
      return;
    }
    setError(undefined);
    const sent = drafts.map((d) => d.key);
    save.mutate(
      { practiceId, ...parsed.data },
      {
        // The new documents are named by the server now: keep the ids even if
        // the owner went on typing, or the next save would make them again.
        onSuccess: ({ ids }) => {
          const named = new Map(sent.map((key, index) => [key, ids[index]]));
          setDrafts((current) =>
            current.map((d) => {
              const id = named.get(d.key);
              return id && !d.id ? { ...d, id } : d;
            }),
          );
        },
      },
    );
  }

  // Kinds not on the list yet come first among the suggestions.
  const missing = DOCUMENT_KINDS.filter(
    (kind) => kind === "other" || !drafts.some((d) => d.kind === kind),
  );

  return (
    <FramePanel>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle className="flex flex-wrap items-center gap-2">
            Документы для клиентов
            {saved.documents.length > 0 && (
              <Badge variant="success-light">Запрашиваются при записи</Badge>
            )}
          </FrameTitle>
          <FrameDescription>
            Клиент отмечает согласие при записи; мы сохраняем версию документа,
            время и адрес. Новый текст — новая версия: её попросят принять при
            следующей записи. Тексты составляете вы: Synoro их не проверяет.
          </FrameDescription>
        </FrameHeader>

        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Документов пока нет — при записи клиент ничего не принимает.
          </p>
        ) : (
          <ol className="flex flex-col divide-y rounded-md border">
            {drafts.map((draft, index) => {
              const stored = draft.id ? versions.get(draft.id) : undefined;
              return (
                <li key={draft.key} className="flex flex-col gap-3 p-3">
                  <div className="flex items-start gap-2">
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor={`document-title-${draft.key}`}>
                        Название
                      </FieldLabel>
                      <Input
                        id={`document-title-${draft.key}`}
                        maxLength={DOCUMENT_TITLE_MAX}
                        placeholder="Например: Договор-оферта"
                        value={draft.title}
                        onChange={(e) =>
                          patch(draft.key, { title: e.target.value })
                        }
                      />
                    </Field>
                    <div className="flex gap-1 pt-6">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Выше"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Ниже"
                        disabled={index === drafts.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Убрать документ"
                        onClick={() =>
                          setDrafts(drafts.filter((d) => d.key !== draft.key))
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <Select
                      items={DOCUMENT_KIND_LABELS}
                      value={draft.kind}
                      onValueChange={(kind) =>
                        patch(draft.key, { kind: kind as DocumentKind })
                      }
                    >
                      <SelectTrigger
                        className="w-full sm:w-80"
                        aria-label="Вид документа"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {DOCUMENT_KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Field orientation="horizontal" className="w-auto">
                      <Switch
                        id={`document-required-${draft.key}`}
                        checked={draft.required}
                        onCheckedChange={(required) =>
                          patch(draft.key, { required })
                        }
                      />
                      <FieldLabel
                        htmlFor={`document-required-${draft.key}`}
                        className="font-normal"
                      >
                        Без согласия не записаться
                      </FieldLabel>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor={`document-body-${draft.key}`}>
                      Текст
                    </FieldLabel>
                    <Textarea
                      id={`document-body-${draft.key}`}
                      rows={8}
                      maxLength={DOCUMENT_BODY_MAX}
                      placeholder="Вставьте текст документа целиком"
                      value={draft.body}
                      onChange={(e) =>
                        patch(draft.key, { body: e.target.value })
                      }
                    />
                    <FieldDescription>
                      {stored
                        ? // The date ends with «г.»: no full stop after it.
                          `Версия ${stored.version} от ${stored.publishedAt.toLocaleDateString(
                            "ru-RU",
                            { day: "numeric", month: "long", year: "numeric" },
                          )} Приняли: ${stored.accepted} ${pluralize(
                            stored.accepted,
                            ["раз", "раза", "раз"],
                          )}.`
                        : "Новый документ: клиенты увидят его после сохранения."}
                    </FieldDescription>
                  </Field>
                </li>
              );
            })}
          </ol>
        )}

        {!full && (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">Добавить:</span>
            <div className="flex flex-wrap gap-2">
              {missing.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => add(kind)}
                >
                  <PlusIcon />
                  {DOCUMENT_KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          </div>
        )}

        <Field orientation="horizontal" className="items-start">
          <Switch
            id="documents-minors"
            checked={minors}
            onCheckedChange={setMinors}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="documents-minors">
              Принимаю клиентов младше 18 лет
            </FieldLabel>
            <FieldDescription>
              На странице записи появится отметка «Записываю ребёнка». Тогда
              документы принимает родитель или законный представитель: мы
              сохраним его имя и имя ребёнка.
            </FieldDescription>
          </div>
        </Field>

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!changed || save.isPending}>
            Сохранить документы
          </Button>
          <SaveState dirty={changed} savedAt={savedAt} />
          {full && (
            <span className="text-xs text-muted-foreground">
              Не больше {DOCUMENTS_MAX} документов
            </span>
          )}
        </div>
      </form>
    </FramePanel>
  );
}

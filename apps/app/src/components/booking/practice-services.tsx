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
  formatCredits,
  formatMinutes,
  SERVICE_CREDITS_MAX,
  SERVICE_MAX,
  SERVICE_MINUTES,
  type ServiceInput,
  servicesFormSchema,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { SaveState } from "../settings/save-state";
import { ErrorState } from "./states";
import { useTerms } from "./terms";

/** A service being edited; `key` is local, `id` is the stored row's. */
interface Draft {
  key: string;
  id?: string;
  name: string;
  minutes: number;
  credits: number;
  active: boolean;
}

type Saved = {
  id: string;
  name: string;
  minutes: number;
  credits: number;
  active: boolean;
};

const toDraft = (s: Saved): Draft => ({ ...s, key: s.id });

const fromDraft = ({ key: _, ...s }: Draft): ServiceInput => s;

/** Lengths to pick from, plus the one a service already has if it is odd. */
function minuteOptions(current: number[]) {
  return [...new Set([...SERVICE_MINUTES, ...current])].sort((a, b) => a - b);
}

const CREDIT_OPTIONS = Array.from(
  { length: SERVICE_CREDITS_MAX },
  (_, i) => i + 1,
);

/**
 * What clients book: the owner names the services, sets how long each lasts
 * and what it costs in credits of the balance, and saves them at once.
 * With one service the booking page shows no picker, as before.
 */
export function PracticeServices({ practiceId }: { practiceId: string }) {
  const list = useQuery(
    orpc.service.list.queryOptions({ input: { practiceId } }),
  );

  if (list.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (list.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить услуги."
        onRetry={() => list.refetch()}
      />
    );
  }
  return <Editor practiceId={practiceId} saved={list.data.services} />;
}

function Editor({ practiceId, saved }: { practiceId: string; saved: Saved[] }) {
  const terms = useTerms();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => saved.map(toDraft));
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = useMutation({
    ...orpc.service.save.mutationOptions(),
    onSuccess: async () => {
      setSavedAt(Date.now());
      toast.success("Услуги сохранены");
      await queryClient.invalidateQueries({ queryKey: orpc.service.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (e) => toast.error(e.message),
  });

  const changed =
    JSON.stringify(drafts.map(fromDraft)) !==
    JSON.stringify(saved.map((s) => fromDraft(toDraft(s))));
  const full = drafts.length >= SERVICE_MAX;
  const minutes = minuteOptions(drafts.map((d) => d.minutes));

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

  function add() {
    setDrafts([
      ...drafts,
      {
        key: crypto.randomUUID(),
        name: "",
        minutes: 60,
        credits: 1,
        active: true,
      },
    ]);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = servicesFormSchema.safeParse({
      services: drafts.map(fromDraft),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте услуги");
      return;
    }
    setError(undefined);
    const sent = drafts;
    save.mutate(
      { practiceId, services: parsed.data.services },
      {
        // Show what was stored, unless the owner kept editing meanwhile.
        onSuccess: ({ services }) =>
          setDrafts((current) =>
            current === sent ? services.map(toDraft) : current,
          ),
      },
    );
  }

  return (
    <FramePanel>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle className="flex flex-wrap items-center gap-2">
            Услуги
            <Badge variant="info-light">{drafts.length}</Badge>
          </FrameTitle>
          <FrameDescription>
            Что клиент выбирает при записи: название, длительность и цена в
            занятиях — столько спишется с баланса. Если услуга одна, выбирать
            ничего не нужно.
          </FrameDescription>
        </FrameHeader>

        <ol className="flex flex-col divide-y rounded-md border">
          {drafts.map((draft, index) => (
            <li key={draft.key} className="flex flex-col gap-3 p-3">
              <div className="flex items-start gap-2">
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor={`service-${draft.key}`}>
                    Название
                  </FieldLabel>
                  <Input
                    id={`service-${draft.key}`}
                    maxLength={80}
                    placeholder="Например: первичная консультация"
                    value={draft.name}
                    onChange={(e) => patch(draft.key, { name: e.target.value })}
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
                    aria-label="Удалить услугу"
                    disabled={drafts.length === 1}
                    onClick={() =>
                      setDrafts(drafts.filter((d) => d.key !== draft.key))
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <Field className="w-40">
                  <FieldLabel htmlFor={`service-minutes-${draft.key}`}>
                    Длительность
                  </FieldLabel>
                  <Select
                    items={Object.fromEntries(
                      minutes.map((m) => [String(m), formatMinutes(m)]),
                    )}
                    value={String(draft.minutes)}
                    onValueChange={(value) =>
                      patch(draft.key, { minutes: Number(value) })
                    }
                  >
                    <SelectTrigger id={`service-minutes-${draft.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {minutes.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {formatMinutes(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="w-44">
                  <FieldLabel htmlFor={`service-credits-${draft.key}`}>
                    Цена
                  </FieldLabel>
                  <Select
                    items={Object.fromEntries(
                      CREDIT_OPTIONS.map((c) => [
                        String(c),
                        formatCredits(c, terms),
                      ]),
                    )}
                    value={String(draft.credits)}
                    onValueChange={(value) =>
                      patch(draft.key, { credits: Number(value) })
                    }
                  >
                    <SelectTrigger id={`service-credits-${draft.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CREDIT_OPTIONS.map((c) => (
                        <SelectItem key={c} value={String(c)}>
                          {formatCredits(c, terms)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field orientation="horizontal" className="w-auto pb-2">
                  <Switch
                    id={`service-active-${draft.key}`}
                    checked={draft.active}
                    onCheckedChange={(active) => patch(draft.key, { active })}
                  />
                  <FieldLabel
                    htmlFor={`service-active-${draft.key}`}
                    className="font-normal"
                  >
                    Показывать клиентам
                  </FieldLabel>
                </Field>
              </div>
            </li>
          ))}
        </ol>

        <FieldDescription>
          Уже сделанные записи сохраняют свою цену и длительность. Удалить можно
          любую услугу: если по ней были записи, она просто скроется со
          страницы.
        </FieldDescription>

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={full} onClick={add}>
            <PlusIcon />
            Добавить услугу
          </Button>
          <Button type="submit" disabled={!changed || save.isPending}>
            Сохранить услуги
          </Button>
          <SaveState dirty={changed} savedAt={savedAt} />
          {full && (
            <span className="text-xs text-muted-foreground">
              Не больше {SERVICE_MAX} услуг
            </span>
          )}
        </div>
      </form>
    </FramePanel>
  );
}

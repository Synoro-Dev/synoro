"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  MAX_WORKFLOWS,
  renderWorkflowText,
  WORKFLOW_PRESETS,
  WORKFLOW_TRIGGERS,
  WORKFLOW_VARIABLES,
  type WorkflowForm,
  type WorkflowTrigger,
  type WorkflowVariable,
  workflowFormSchema,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareTextIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";

import { orpc } from "~/orpc/react";
import { ProRequired } from "../billing/pro-required";
import { ConfirmButton } from "./confirm-button";
import { ErrorState } from "./states";

/** «через 2 ч после встречи». */
function whenText(trigger: WorkflowTrigger, amount: number) {
  if (trigger === "after_end") return `через ${amount} ч после встречи`;
  if (trigger === "inactive") return `когда ${amount} дн. нет записи`;
  return amount === 0
    ? "когда занятий не осталось"
    : `когда осталось ${amount} или меньше`;
}

type Rule = WorkflowForm & { id?: string };

function Editor({
  rule,
  practiceName,
  bookingUrl,
  pending,
  onSave,
  onClose,
}: {
  rule: Rule;
  practiceName: string;
  bookingUrl: string;
  pending: boolean;
  onSave: (rule: WorkflowForm) => void;
  onClose: () => void;
}) {
  const preset = WORKFLOW_PRESETS[rule.trigger];
  const [amount, setAmount] = useState(String(rule.amount));
  const [subject, setSubject] = useState(rule.subject);
  const [text, setText] = useState(rule.text);
  const [active, setActive] = useState(rule.active);
  const [error, setError] = useState<string>();
  const textRef = useRef<HTMLTextAreaElement>(null);

  const sample: Record<WorkflowVariable, string> = {
    имя: "Иван",
    практика: practiceName,
    дата: "3 ноября",
    время: "19:00",
    баланс: "1",
    ссылка: bookingUrl,
    кабинет: new URL("/bookings", bookingUrl).href,
  };

  function insert(variable: WorkflowVariable) {
    const field = textRef.current;
    const at = field?.selectionStart ?? text.length;
    const to = field?.selectionEnd ?? at;
    setText(`${text.slice(0, at)}{${variable}}${text.slice(to)}`);
    setError(undefined);
    field?.focus();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = workflowFormSchema.safeParse({
      trigger: rule.trigger,
      amount: amount.trim() === "" ? Number.NaN : Number(amount),
      subject,
      text,
      active,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте поля");
      return;
    }
    setError(undefined);
    onSave(parsed.data);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{preset.title}</DialogTitle>
        <DialogDescription>{preset.description}</DialogDescription>
      </DialogHeader>

      <Field className="max-w-48">
        <FieldLabel htmlFor="workflow-amount">{preset.amountLabel}</FieldLabel>
        <Input
          id="workflow-amount"
          type="number"
          inputMode="numeric"
          min={preset.min}
          max={preset.max}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <FieldDescription>
          От {preset.min} до {preset.max}, {preset.amountUnit}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="workflow-subject">Тема письма</FieldLabel>
        <Input
          id="workflow-subject"
          maxLength={120}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="workflow-text">Текст</FieldLabel>
        <Textarea
          id="workflow-text"
          ref={textRef}
          rows={6}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(WORKFLOW_VARIABLES) as WorkflowVariable[]).map(
            (variable) => (
              <Button
                key={variable}
                type="button"
                variant="outline"
                size="xs"
                title={WORKFLOW_VARIABLES[variable]}
                onClick={() => insert(variable)}
              >
                {`{${variable}}`}
              </Button>
            ),
          )}
        </div>
        <FieldDescription>
          Переменные подставятся для каждого клиента. Пустая строка — новый
          абзац.
        </FieldDescription>
      </Field>

      <div className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3 text-sm">
        <span className="font-medium">
          {renderWorkflowText(subject, sample) || "—"}
        </span>
        <span className="whitespace-pre-line text-muted-foreground">
          {renderWorkflowText(text, sample)}
        </span>
      </div>

      <Field orientation="horizontal">
        <Switch
          id="workflow-active"
          checked={active}
          onCheckedChange={setActive}
        />
        <FieldLabel htmlFor="workflow-active" className="font-normal">
          Отправлять
        </FieldLabel>
      </Field>

      {error ? <FieldError>{error}</FieldError> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The practice's own messages to clients («Про»): after a meeting, a package
 * running out, a client who went quiet. The worker mails them (see
 * `docs/reminders.md`); here the owner writes the rules. Owner only.
 */
export function PracticeWorkflows({
  practiceId,
  practiceName,
  bookingUrl,
  isOwner,
}: {
  practiceId: string;
  practiceName: string;
  bookingUrl: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    ...orpc.workflow.list.queryOptions({ input: { practiceId } }),
    enabled: isOwner,
  });
  const [editing, setEditing] = useState<Rule>();

  const done = async () => {
    setEditing(undefined);
    await queryClient.invalidateQueries({ queryKey: orpc.workflow.key() });
  };
  const onError = (error: { message: string }) => toast.error(error.message);

  const create = useMutation({
    ...orpc.workflow.create.mutationOptions(),
    onSuccess: async () => {
      toast.success("Правило добавлено");
      await done();
    },
    onError,
  });
  const update = useMutation({
    ...orpc.workflow.update.mutationOptions(),
    onSuccess: done,
    onError,
  });
  const remove = useMutation({
    ...orpc.workflow.delete.mutationOptions(),
    onSuccess: async () => {
      toast.success("Правило удалено");
      await done();
    },
    onError,
  });

  if (!isOwner) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <Alert variant="info">
          <MessageSquareTextIcon />
          <AlertTitle>
            Сообщения клиентам настраивает владелец практики
          </AlertTitle>
          <AlertDescription>
            Напоминания о записях приходят клиентам автоматически, свои правила
            добавляет только владелец.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (settings.isPending) {
    return <Skeleton className="h-96 max-w-3xl rounded-xl" />;
  }
  if (settings.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить правила."
        onRetry={() => settings.refetch()}
      />
    );
  }

  const { pro, workflows } = settings.data;
  const full = workflows.length >= MAX_WORKFLOWS;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Свои сообщения клиентам</FrameTitle>
            <FrameDescription>
              Письмо уходит само, когда наступает событие, и только один раз.
              Клиенты получают его с 9:00 до 21:00 по времени практики.
            </FrameDescription>
          </FrameHeader>

          {pro ? null : <ProRequired feature="Свои сообщения клиентам" />}

          {workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Правил пока нет. Выберите, с чего начать.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {workflows.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center gap-3 p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {WORKFLOW_PRESETS[rule.trigger].title}
                      <Badge
                        variant={
                          rule.active && pro ? "success-light" : "warning-light"
                        }
                      >
                        {rule.active
                          ? pro
                            ? "Включено"
                            : "Не отправляется без «Про»"
                          : "Выключено"}
                      </Badge>
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {whenText(rule.trigger, rule.amount)} · {rule.subject}
                    </span>
                  </div>
                  <Switch
                    aria-label="Отправлять"
                    checked={rule.active}
                    disabled={update.isPending || (!pro && !rule.active)}
                    onCheckedChange={(active) =>
                      update.mutate({
                        id: rule.id,
                        trigger: rule.trigger,
                        amount: rule.amount,
                        subject: rule.subject,
                        text: rule.text,
                        active,
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!pro}
                    onClick={() => setEditing(rule)}
                  >
                    Изменить
                  </Button>
                  <ConfirmButton
                    title="Удалить правило?"
                    description="Письма по нему больше не уйдут. Уже отправленные останутся у клиентов."
                    confirmLabel="Удалить"
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate({ id: rule.id })}
                  >
                    Удалить
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          )}
        </FramePanel>
      </Frame>

      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Добавить правило</FrameTitle>
            <FrameDescription>
              {full
                ? `Достигнут предел — ${MAX_WORKFLOWS} правил на практику.`
                : "Заготовку можно переписать как угодно."}
            </FrameDescription>
          </FrameHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            {WORKFLOW_TRIGGERS.map((trigger) => {
              const preset = WORKFLOW_PRESETS[trigger];
              return (
                <div
                  key={trigger}
                  className="flex flex-col items-start gap-2 rounded-md border p-3"
                >
                  <span className="font-medium">{preset.title}</span>
                  <span className="flex-1 text-sm text-muted-foreground">
                    {preset.description}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!pro || full}
                    onClick={() =>
                      setEditing({
                        trigger,
                        amount: preset.defaultAmount,
                        subject: preset.subject,
                        text: preset.text,
                        active: true,
                      })
                    }
                  >
                    <PlusIcon />
                    Добавить
                  </Button>
                </div>
              );
            })}
          </div>
        </FramePanel>
      </Frame>

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
      >
        <DialogContent className="sm:max-w-lg">
          {editing ? (
            <Editor
              // A fresh form for each rule opened.
              key={editing.id ?? editing.trigger}
              rule={editing}
              practiceName={practiceName}
              bookingUrl={bookingUrl}
              pending={create.isPending || update.isPending}
              onClose={() => setEditing(undefined)}
              onSave={(rule) =>
                editing.id
                  ? update.mutate(
                      { id: editing.id, ...rule },
                      {
                        onSuccess: () => toast.success("Правило сохранено"),
                      },
                    )
                  : create.mutate({ practiceId, ...rule })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

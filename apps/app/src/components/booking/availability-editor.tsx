"use client";

import { Button, Label, Skeleton, Switch, toast } from "@acme/ui";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@acme/ui/reui/frame";
import {
  type AvailabilityRuleValues,
  availabilityFormSchema,
} from "@acme/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState, PageHeading } from "./states";
import { WEEKDAY_NAMES } from "./time";
import { TimeSelect } from "./time-select";

type DraftRule = AvailabilityRuleValues & { key: string };

const DEFAULT_INTERVAL = { startMinute: 600, endMinute: 1080 };

const toPayload = (rules: DraftRule[]) =>
  rules
    .map(({ weekday, startMinute, endMinute }) => ({
      weekday,
      startMinute,
      endMinute,
    }))
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);

/** Weekly working hours, cal.com style: a switch and intervals per day. */
export function AvailabilityEditor({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const rules = useQuery(
    orpc.availability.list.queryOptions({ input: { practiceId } }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Расписание"
        description={`Часы приёма по времени ${timezone}`}
      />
      {rules.isError ? (
        <ErrorState onRetry={() => rules.refetch()} />
      ) : rules.isPending ? (
        <Skeleton className="h-[480px] w-full rounded-xl" />
      ) : (
        // Keyed by the saved rules, so a refetch after saving resets the draft.
        <RulesForm
          key={JSON.stringify(rules.data)}
          practiceId={practiceId}
          initial={rules.data}
        />
      )}
    </div>
  );
}

function RulesForm({
  practiceId,
  initial,
}: {
  practiceId: string;
  initial: AvailabilityRuleValues[];
}) {
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<DraftRule[]>(() =>
    initial.map((r) => ({ ...r, key: crypto.randomUUID() })),
  );
  const dirty =
    JSON.stringify(toPayload(rules)) !==
    JSON.stringify(toPayload(initial.map((r) => ({ ...r, key: "" }))));

  const save = useMutation({
    ...orpc.availability.replace.mutationOptions(),
    onSuccess: async () => {
      toast.success("Расписание сохранено");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.availability.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const update = (key: string, patch: Partial<AvailabilityRuleValues>) =>
    setRules((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addInterval = (weekday: number) =>
    setRules((all) => {
      const last = all
        .filter((r) => r.weekday === weekday)
        .sort((a, b) => b.endMinute - a.endMinute)[0];
      const interval =
        last && last.endMinute <= 1380
          ? {
              startMinute: last.endMinute + 60,
              endMinute: Math.min(1440, last.endMinute + 180),
            }
          : DEFAULT_INTERVAL;
      return [...all, { key: crypto.randomUUID(), weekday, ...interval }];
    });
  const toggleDay = (weekday: number, on: boolean) =>
    setRules((all) =>
      on
        ? [...all, { key: crypto.randomUUID(), weekday, ...DEFAULT_INTERVAL }]
        : all.filter((r) => r.weekday !== weekday),
    );
  const copyToWeekdays = (weekday: number) =>
    setRules((all) => {
      const source = all.filter((r) => r.weekday === weekday);
      const others = [1, 2, 3, 4, 5].filter((d) => d !== weekday);
      return [
        ...all.filter((r) => !others.includes(r.weekday)),
        ...others.flatMap((d) =>
          source.map((r) => ({ ...r, weekday: d, key: crypto.randomUUID() })),
        ),
      ];
    });

  function onSave() {
    const parsed = availabilityFormSchema.safeParse({
      rules: toPayload(rules),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте интервалы");
      return;
    }
    save.mutate({ practiceId, rules: parsed.data.rules });
  }

  const hours =
    rules.reduce((sum, r) => sum + (r.endMinute - r.startMinute), 0) / 60;

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <Frame spacing="default" className="min-w-0" stacked>
        <FramePanel>
          <FrameHeader className="p-0">
            <FrameTitle>Рабочие дни</FrameTitle>
            <FrameDescription>
              Клиенты записываются только в эти часы
            </FrameDescription>
          </FrameHeader>
        </FramePanel>
        {WEEKDAY_NAMES.map((name, index) => {
          const weekday = index + 1;
          const dayRules = rules
            .filter((r) => r.weekday === weekday)
            .sort((a, b) => a.startMinute - b.startMinute);
          const on = dayRules.length > 0;
          return (
            <FramePanel
              key={name}
              className="flex flex-col gap-3 sm:flex-row sm:items-start"
            >
              <div className="flex w-40 shrink-0 items-center gap-3 pt-1.5">
                <Switch
                  checked={on}
                  onCheckedChange={(checked) => toggleDay(weekday, checked)}
                  id={`day-${weekday}`}
                />
                <Label htmlFor={`day-${weekday}`} className="cursor-pointer">
                  {name}
                </Label>
              </div>

              {on ? (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {dayRules.map((rule, i) => (
                    <div
                      key={rule.key}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <TimeSelect
                        label={`${name}: начало`}
                        value={rule.startMinute}
                        onChange={(startMinute) =>
                          update(rule.key, { startMinute })
                        }
                      />
                      <span className="text-muted-foreground">—</span>
                      <TimeSelect
                        label={`${name}: конец`}
                        value={rule.endMinute}
                        endOfDay
                        onChange={(endMinute) =>
                          update(rule.key, { endMinute })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Удалить интервал"
                        onClick={() =>
                          setRules((all) =>
                            all.filter((r) => r.key !== rule.key),
                          )
                        }
                      >
                        <Trash2Icon />
                      </Button>
                      {i === 0 && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Добавить интервал"
                            onClick={() => addInterval(weekday)}
                          >
                            <PlusIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Скопировать на все будни"
                            title="Скопировать на все будни"
                            onClick={() => copyToWeekdays(weekday)}
                          >
                            <CopyIcon />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="pt-1.5 text-sm text-muted-foreground">
                  Выходной
                </span>
              )}
            </FramePanel>
          );
        })}
        <FrameFooter className="flex-row items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
          </span>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? "Сохранение…" : "Сохранить"}
          </Button>
        </FrameFooter>
      </Frame>

      <Frame spacing="default" className="min-w-0 self-start">
        <FramePanel className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">В неделю</span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {hours} ч
          </span>
          <span className="text-xs text-muted-foreground">
            рабочего времени по расписанию
          </span>
        </FramePanel>
        <FramePanel className="flex flex-col gap-2 text-sm">
          <FrameTitle>Как считаются слоты</FrameTitle>
          <p className="text-muted-foreground">
            Платная консультация — 1 час, с начала каждого часа. Бесплатная — 30
            минут, по сетке :00 и :30.
          </p>
          <p className="text-muted-foreground">
            Закрытое время и существующие записи из слотов исключаются.
          </p>
        </FramePanel>
      </Frame>
    </div>
  );
}

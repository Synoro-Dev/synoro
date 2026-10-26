"use client";

import { Button, Skeleton, toast } from "@acme/ui";
import {
  type AvailabilityRuleValues,
  availabilityFormSchema,
} from "@acme/validators";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { WEEKDAY_NAMES } from "./time";
import { TimeSelect } from "./time-select";

/** Weekly working hours, edited as a whole and saved with one call. */
export function AvailabilityEditor({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const { data, isPending } = useQuery(
    orpc.availability.list.queryOptions({ input: { practiceId } }),
  );

  if (isPending || !data) return <Skeleton className="h-96 w-full" />;
  // Keyed by the loaded rules, so a refetch after saving resets the draft.
  return (
    <RulesForm
      key={JSON.stringify(data)}
      practiceId={practiceId}
      timezone={timezone}
      initial={data}
    />
  );
}

function RulesForm({
  practiceId,
  timezone,
  initial,
}: {
  practiceId: string;
  timezone: string;
  initial: AvailabilityRuleValues[];
}) {
  const queryClient = useQueryClient();
  const [rules, setRules] = useState(() =>
    initial.map(({ weekday, startMinute, endMinute }) => ({
      key: crypto.randomUUID(),
      weekday,
      startMinute,
      endMinute,
    })),
  );

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

  function onSave() {
    const payload = rules.map(({ weekday, startMinute, endMinute }) => ({
      weekday,
      startMinute,
      endMinute,
    }));
    const parsed = availabilityFormSchema.safeParse({ rules: payload });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте интервалы");
      return;
    }
    save.mutate({ practiceId, rules: parsed.data.rules });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Часы приёма по времени {timezone}. Платные консультации — по часу с
        начала каждого часа, бесплатные — по 30 минут.
      </p>
      {WEEKDAY_NAMES.map((name, index) => {
        const weekday = index + 1;
        const dayRules = rules.filter((r) => r.weekday === weekday);
        return (
          <div
            key={name}
            className="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-start"
          >
            <span className="w-32 shrink-0 pt-2 text-sm font-medium">
              {name}
            </span>
            <div className="flex flex-1 flex-col gap-2">
              {dayRules.length === 0 && (
                <span className="pt-2 text-sm text-muted-foreground">
                  Выходной
                </span>
              )}
              {dayRules.map((rule) => (
                <div key={rule.key} className="flex items-center gap-2">
                  <TimeSelect
                    label={`${name}: начало`}
                    value={rule.startMinute}
                    min={0}
                    max={1410}
                    onChange={(startMinute) =>
                      update(rule.key, { startMinute })
                    }
                  />
                  <span>—</span>
                  <TimeSelect
                    label={`${name}: конец`}
                    value={rule.endMinute}
                    min={30}
                    max={1440}
                    onChange={(endMinute) => update(rule.key, { endMinute })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Удалить интервал"
                    onClick={() =>
                      setRules((all) => all.filter((r) => r.key !== rule.key))
                    }
                  >
                    <IconTrash />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRules((all) => [
                  ...all,
                  {
                    key: crypto.randomUUID(),
                    weekday,
                    startMinute: 600,
                    endMinute: 1080,
                  },
                ])
              }
            >
              <IconPlus /> Интервал
            </Button>
          </div>
        );
      })}
      <div>
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? "Сохранение…" : "Сохранить расписание"}
        </Button>
      </div>
    </div>
  );
}

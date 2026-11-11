"use client";

import { Label, Switch, ToggleGroup, ToggleGroupItem, toast } from "@synoro/ui";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  CANCEL_HOURS,
  type CancelRules,
  formatCancelHours,
  formatCredits,
  formatHoursLess,
} from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { useTerms } from "./terms";

function Rule({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/** The deadline for a booking on Wednesday at 19:00, per `CANCEL_HOURS`. */
const DEADLINE_EXAMPLE: Record<number, string> = {
  3: "до 16:00 среды",
  6: "до 13:00 среды",
  12: "до 7:00 среды",
  24: "до 19:00 вторника",
  48: "до 19:00 понедельника",
  72: "до 19:00 воскресенья",
};

/**
 * The rules a practice's clients book by, in plain words with an example.
 * The owner sets the cancellation deadline and whether a late cancellation
 * is allowed (`practice.setCancelRules`); each change applies at once, to
 * bookings already made too. Administrators read them.
 */
export function PracticeRules({
  practiceId,
  rules,
  isOwner,
}: {
  practiceId: string;
  rules: CancelRules;
  isOwner: boolean;
}) {
  const terms = useTerms();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(rules);
  /** What the server has, to go back to when a change fails. */
  const [saved, setSaved] = useState(rules);
  const save = useMutation({
    ...orpc.practice.setCancelRules.mutationOptions(),
    onSuccess: async (result) => {
      setSaved(result);
      toast.success("Правила сохранены");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error) => {
      setCurrent(saved);
      toast.error(error.message);
    },
  });

  function change(next: CancelRules) {
    setCurrent(next);
    save.mutate({ practiceId, ...next });
  }

  const { cancelHours, lateCancel } = current;
  const one = formatCredits(1, terms);

  return (
    <Frame spacing="default" className="min-w-0 max-w-3xl">
      {isOwner && (
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Отмена и перенос</FrameTitle>
            <FrameDescription>
              Действует сразу, в том числе для уже сделанных записей.
            </FrameDescription>
          </FrameHeader>
          <div className="flex flex-col gap-2">
            <Label id="cancel-hours">
              Клиент сам отменяет запись не позднее чем
            </Label>
            <ToggleGroup
              aria-labelledby="cancel-hours"
              variant="outline"
              size="sm"
              value={[String(cancelHours)]}
              disabled={save.isPending}
              onValueChange={(value) => {
                const next = Number(value[0]);
                if (!next || next === cancelHours) return;
                change({ cancelHours: next, lateCancel });
              }}
            >
              {CANCEL_HOURS.map((option) => (
                <ToggleGroupItem
                  key={option}
                  value={String(option)}
                  className="px-2.5"
                >
                  {option}&nbsp;ч
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">до начала</p>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="late-cancel"
              checked={lateCancel}
              disabled={save.isPending}
              onCheckedChange={(checked) =>
                change({ cancelHours, lateCancel: checked })
              }
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="late-cancel">
                Разрешить позднюю отмену без возврата
              </Label>
              <p className="text-xs text-muted-foreground">
                Если до начала {formatHoursLess(cancelHours)}, клиент всё равно
                может отменить запись сам, но {one} не вернётся на баланс. Время
                освободится для других.
              </p>
            </div>
          </div>
        </FramePanel>
      )}
      <FramePanel className="flex flex-col gap-5">
        <FrameHeader className="p-0">
          <FrameTitle>Правила записи</FrameTitle>
          <FrameDescription>
            {isOwner
              ? "Так их видят клиенты."
              : "Одинаковые для всех клиентов. Меняет их владелец практики."}
          </FrameDescription>
        </FrameHeader>
        <Rule title="Отмена и перенос">
          <p>
            Клиент сам отменяет или переносит запись не позднее чем{" "}
            {formatCancelHours(cancelHours)} до начала. При отмене {one}{" "}
            возвращается на баланс.
          </p>
          <p className="rounded-md bg-muted px-3 py-2 text-foreground dark:bg-muted/50">
            Например, запись на среду в&nbsp;19:00:{" "}
            {DEADLINE_EXAMPLE[cancelHours] ?? "заранее"} клиент справится сам.
            {lateCancel
              ? " Позже он сможет только отменить её, без возврата."
              : " Позже отменить или перенести её можете только вы или администратор."}
          </p>
        </Rule>
        <Rule title={`Если до начала ${formatHoursLess(cancelHours)}`}>
          {lateCancel ? (
            <p>
              Клиент может отменить запись сам: {one} не вернётся, перед отменой
              он это увидит. Перенести запись может только специалист.
            </p>
          ) : (
            <p>
              Клиент сам уже ничего не меняет. Вы решаете: отменить запись и
              вернуть оплату на баланс или отменить без возврата.
            </p>
          )}
          <p>
            Если клиент не пришёл, отметьте это в записи: оплата не вернётся.
          </p>
        </Rule>
        <Rule title={`Бесплатная запись: «${terms.free}»`}>
          <p>
            Клиент может отменить или перенести её в любой момент до начала.
          </p>
        </Rule>
        <Rule title="Запись с онлайн-оплатой">
          <p>
            Пока клиент платит, время держится за ним 15&nbsp;минут. Если оплата
            не пришла, время снова свободно.
          </p>
        </Rule>
      </FramePanel>
    </Frame>
  );
}

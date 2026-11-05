"use client";

import { Label, Switch, ToggleGroup, ToggleGroupItem, toast } from "@synoro/ui";
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { formatMinutes, INTRO_MINUTES } from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { useTerms } from "./terms";

/**
 * The free intro: how long it lasts, and whether visitors book it themselves
 * on the booking page — once per person, no payment. Staff book it in the
 * calendar either way.
 */
export function PracticeFreeBooking({
  practiceId,
  enabled,
  introMinutes,
  onEnabledChange,
}: {
  practiceId: string;
  enabled: boolean;
  introMinutes: number;
  /** Follows the switch, for a preview beside it. */
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const terms = useTerms();
  const queryClient = useQueryClient();
  const [on, setOn] = useState(enabled);
  const [minutes, setMinutes] = useState(introMinutes);
  /** The length last saved, to go back to when a change fails. */
  const [savedMinutes, setSavedMinutes] = useState(introMinutes);
  // The first setup refetches the practice: a mount can precede fresh values.
  const [seen, setSeen] = useState({ enabled, introMinutes });
  if (seen.enabled !== enabled || seen.introMinutes !== introMinutes) {
    setSeen({ enabled, introMinutes });
    setOn(enabled);
    setMinutes(introMinutes);
    setSavedMinutes(introMinutes);
  }
  const save = useMutation({
    ...orpc.practice.setFreeBooking.mutationOptions(),
    onSuccess: async (result, input) => {
      setSavedMinutes(result.introMinutes);
      toast.success(
        input.introMinutes !== undefined
          ? `«${terms.free}» длится ${formatMinutes(result.introMinutes)}`
          : result.enabled
            ? `Клиенты могут записаться: ${terms.free.toLowerCase()}`
            : `Запись на «${terms.free}» — только через вас`,
      );
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error, input) => {
      if (input.enabled !== undefined) {
        setOn(!input.enabled);
        onEnabledChange?.(!input.enabled);
      }
      if (input.introMinutes !== undefined) setMinutes(savedMinutes);
      toast.error(error.message);
    },
  });

  return (
    <FramePanel className="flex flex-col gap-4">
      <FrameHeader className="p-0">
        <FrameTitle>{terms.free} — бесплатно</FrameTitle>
        <FrameDescription>
          Новые клиенты сами выбирают время на странице записи:{" "}
          {formatMinutes(minutes)}, без оплаты, один раз на человека.
        </FrameDescription>
      </FrameHeader>
      <div className="flex items-center gap-3">
        <Switch
          id="free-booking"
          checked={on}
          disabled={save.isPending}
          onCheckedChange={(checked) => {
            setOn(checked);
            onEnabledChange?.(checked);
            save.mutate({ practiceId, enabled: checked });
          }}
        />
        <Label htmlFor="free-booking">
          Принимать запись на «{terms.free}» онлайн
        </Label>
      </div>
      <div className="flex flex-col gap-2">
        <Label id="intro-length">Длительность</Label>
        <ToggleGroup
          aria-labelledby="intro-length"
          variant="outline"
          size="sm"
          value={[String(minutes)]}
          disabled={save.isPending}
          onValueChange={(value) => {
            const next = Number(value[0]);
            if (!next || next === minutes) return;
            setMinutes(next);
            save.mutate({ practiceId, introMinutes: next });
          }}
        >
          {INTRO_MINUTES.map((option) => (
            <ToggleGroupItem
              key={option}
              value={String(option)}
              className="px-2.5"
            >
              {formatMinutes(option, true)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          Начинается в :00 или :30. Уже назначенные встречи останутся прежней
          длины.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Повторно записаться не получится ни по той же почте, ни по тому же
        телефону. Если клиент не пришёл, второй попытки тоже не будет. Вы и
        администратор записываете гостей в календаре или в разделе «Свободные
        окна» в любом случае.
      </p>
    </FramePanel>
  );
}

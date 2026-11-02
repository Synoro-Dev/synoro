"use client";

import { Label, Switch, toast } from "@synoro/ui";
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { useTerms } from "./terms";

/**
 * Whether visitors book the free intro themselves on the booking page —
 * once per person, 30 minutes, no payment. Staff book it in the calendar
 * either way.
 */
export function PracticeFreeBooking({
  practiceId,
  enabled,
}: {
  practiceId: string;
  enabled: boolean;
}) {
  const terms = useTerms();
  const queryClient = useQueryClient();
  const [on, setOn] = useState(enabled);
  const save = useMutation({
    ...orpc.practice.setFreeBooking.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.enabled
          ? `Клиенты могут записаться: ${terms.free.toLowerCase()}`
          : `Запись на «${terms.free}» — только через вас`,
      );
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error) => {
      setOn(!on);
      toast.error(error.message);
    },
  });

  return (
    <FramePanel className="flex flex-col gap-4">
      <FrameHeader className="p-0">
        <FrameTitle>{terms.free} — бесплатно</FrameTitle>
        <FrameDescription>
          Новые клиенты сами выбирают время на странице записи: 30 минут, без
          оплаты, один раз на человека.
        </FrameDescription>
      </FrameHeader>
      <div className="flex items-center gap-3">
        <Switch
          id="free-booking"
          checked={on}
          disabled={save.isPending}
          onCheckedChange={(checked) => {
            setOn(checked);
            save.mutate({ practiceId, enabled: checked });
          }}
        />
        <Label htmlFor="free-booking">
          Принимать запись на «{terms.free}» онлайн
        </Label>
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

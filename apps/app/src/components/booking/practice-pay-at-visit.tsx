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

/**
 * Payment at the visit: clients book any service on the booking page without
 * paying online, and the specialist is paid in person. Online payment and
 * packages leave the page meanwhile; balances stay as they are.
 */
export function PracticePayAtVisit({
  practiceId,
  enabled,
}: {
  practiceId: string;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [on, setOn] = useState(enabled);
  // The first setup refetches the practice: a mount can precede fresh values.
  const [seen, setSeen] = useState(enabled);
  if (seen !== enabled) {
    setSeen(enabled);
    setOn(enabled);
  }
  const save = useMutation({
    ...orpc.practice.setPayAtVisit.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.enabled
          ? "Клиенты записываются без оплаты онлайн"
          : "Оплата на приёме выключена",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error, input) => {
      setOn(!input.enabled);
      toast.error(error.message);
    },
  });

  return (
    <FramePanel className="flex flex-col gap-4">
      <FrameHeader className="p-0">
        <FrameTitle>Оплата на приёме</FrameTitle>
        <FrameDescription>
          Клиенты записываются на любую услугу без оплаты онлайн. Запись
          подтверждается сразу, оплату вы принимаете на приёме.
        </FrameDescription>
      </FrameHeader>
      <div className="flex items-center gap-3">
        <Switch
          id="pay-at-visit"
          checked={on}
          disabled={save.isPending}
          onCheckedChange={(checked) => {
            setOn(checked);
            save.mutate({ practiceId, enabled: checked });
          }}
        />
        <Label htmlFor="pay-at-visit">Принимать оплату на приёме</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Пока режим включён, онлайн-оплата и пакеты на странице записи скрыты, а
        вы и администратор записываете клиентов без списания с баланса. Клиент
        может отменить запись до её начала. Не больше трёх предстоящих записей
        на одного человека.
      </p>
    </FramePanel>
  );
}

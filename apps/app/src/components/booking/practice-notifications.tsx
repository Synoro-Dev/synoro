"use client";

import { Label, Switch, toast } from "@synoro/ui";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";

type Setting = "remindClients" | "notifyStaff" | "dailyAgenda";

const SETTINGS: {
  key: Setting;
  label: string;
  description: string;
  on: string;
  off: string;
}[] = [
  {
    key: "remindClients",
    label: "Напоминать клиентам о встрече",
    description:
      "За сутки и за час до начала, со ссылкой на видеовстречу, если она есть.",
    on: "Клиенты получат напоминания",
    off: "Напоминания клиентам выключены",
  },
  {
    key: "notifyStaff",
    label: "Сообщать о новых и отменённых записях",
    description:
      "Вам и администраторам, когда клиент записался или отменил запись.",
    on: "Будем сообщать о записях",
    off: "Сообщения о записях выключены",
  },
  {
    key: "dailyAgenda",
    label: "Присылать расписание на завтра",
    description:
      "В 20:00 по времени практики — список завтрашних встреч с телефонами. Если записей нет, не пишем.",
    on: "Расписание будет приходить в 20:00",
    off: "Расписание на завтра выключено",
  },
];

/**
 * Which notices the practice sends (owner only). Without «Про» they go by
 * mail; on «Про» to Telegram or MAX for those who linked the bot.
 */
export function PracticeNotifications({
  practiceId,
  initial,
}: {
  practiceId: string;
  initial: Record<Setting, boolean>;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(initial);
  const save = useMutation({
    ...orpc.practice.setNotifications.mutationOptions(),
    onSuccess: async (_, input) => {
      const setting = SETTINGS.find((s) => input[s.key] !== undefined);
      if (setting) toast.success(input[setting.key] ? setting.on : setting.off);
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error, input) => {
      setValues((current) => {
        const next = { ...current };
        for (const { key } of SETTINGS) {
          const value = input[key];
          if (value !== undefined) next[key] = !value;
        }
        return next;
      });
      toast.error(error.message);
    },
  });

  return (
    <Frame spacing="default" className="min-w-0">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle>Уведомления</FrameTitle>
          <FrameDescription>
            Приходят на почту, а на тарифе «Про» — в Telegram или MAX тем, кто
            подключил бота в настройках. Подтверждения и отмены записей клиенты
            получают всегда.
          </FrameDescription>
        </FrameHeader>
        {SETTINGS.map((setting) => (
          <div key={setting.key} className="flex items-start gap-3">
            <Switch
              id={`notify-${setting.key}`}
              checked={values[setting.key]}
              disabled={save.isPending}
              onCheckedChange={(checked) => {
                setValues((current) => ({
                  ...current,
                  [setting.key]: checked,
                }));
                save.mutate({ practiceId, [setting.key]: checked });
              }}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`notify-${setting.key}`}>{setting.label}</Label>
              <p className="text-xs text-muted-foreground">
                {setting.description}
              </p>
            </div>
          </div>
        ))}
      </FramePanel>
    </Frame>
  );
}

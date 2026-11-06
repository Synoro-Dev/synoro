"use client";

import { Button, Skeleton, toast } from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { formatPhone } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneIcon, Trash2Icon } from "lucide-react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "./states";

/** «9 ноября» for a YYYY-MM-DD key. */
function dayText(key: string) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  });
}

/** «18:00» for minutes since midnight. */
function clock(minute: number) {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function hoursText(from: number | null, to: number | null) {
  if (from === null && to === null) return "любое время";
  if (from === null) return `до ${clock(to ?? 0)}`;
  if (to === null) return `после ${clock(from)}`;
  return `${clock(from)}–${clock(to)}`;
}

/**
 * Who waits for time (`booking.windows` is where staff look for it): each
 * person's dates, hours and service, and a way to reach them. A person is
 * written to once when matching time frees up (`notifyWaitlist`); staff take
 * a wish off once they have called or booked them.
 */
export function PracticeWaitlist({ practiceId }: { practiceId: string }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    ...orpc.waitlist.list.queryOptions({ input: { practiceId } }),
    refetchInterval: 60_000,
  });
  const remove = useMutation({
    ...orpc.waitlist.leave.mutationOptions(),
    onSuccess: async () => {
      toast.success("Убрано из листа ожидания");
      await queryClient.invalidateQueries({ queryKey: orpc.waitlist.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  if (list.isPending) return <Skeleton className="h-24 rounded-xl" />;
  if (list.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить лист ожидания."
        onRetry={() => list.refetch()}
      />
    );
  }
  const { entries } = list.data;

  return (
    <Frame spacing="default">
      <FrameHeader>
        <FrameTitle className="flex items-center gap-2">
          Лист ожидания
          <Badge variant={entries.length > 0 ? "info-light" : "secondary"}>
            {entries.length}
          </Badge>
        </FrameTitle>
        <FrameDescription>
          Эти люди ждут время. Когда оно освободится после отмены или переноса,
          им придёт одно сообщение; можно и позвонить самим.
        </FrameDescription>
      </FrameHeader>
      <FramePanel>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Пока никто не ждёт. Ссылка на запись предлагает встать в лист, когда
            нет подходящего времени.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{entry.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {dayText(entry.fromDate)}
                    {entry.toDate !== entry.fromDate &&
                      ` — ${dayText(entry.toDate)}`}
                    , {hoursText(entry.fromMinute, entry.toMinute)}
                    {entry.service && ` · ${entry.service}`}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
                    {entry.phone && (
                      <a
                        href={`tel:${entry.phone}`}
                        className="flex items-center gap-1 underline-offset-4 hover:underline"
                      >
                        <PhoneIcon className="size-3" />
                        {formatPhone(entry.phone)}
                      </a>
                    )}
                    <span className="truncate">{entry.email}</span>
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Убрать из листа: ${entry.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ entryId: entry.id })}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </FramePanel>
    </Frame>
  );
}

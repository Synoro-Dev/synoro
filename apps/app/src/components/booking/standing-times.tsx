"use client";

import { isDefinedError } from "@orpc/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseIcon, PinIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { formatDateTime, formatTime } from "./time";

/** «Каждый вторник, 17:00» / «Раз в две недели, вторник, 17:00». */
function describeStanding(
  startsAt: Date,
  intervalWeeks: number,
  timeZone: string,
) {
  const weekday = startsAt.toLocaleDateString("ru-RU", {
    weekday: "long",
    timeZone,
  });
  const time = formatTime(startsAt, timeZone);
  if (intervalWeeks === 1) return `${EVERY[weekday] ?? weekday}, ${time}`;
  return `Раз в две недели, ${weekday}, ${time}`;
}

/** «каждую среду»: the weekday as it reads after «каждый». */
const EVERY: Record<string, string> = {
  понедельник: "Каждый понедельник",
  вторник: "Каждый вторник",
  среда: "Каждую среду",
  четверг: "Каждый четверг",
  пятница: "Каждую пятницу",
  суббота: "Каждую субботу",
  воскресенье: "Каждое воскресенье",
};

/**
 * The client's standing times in one practice («Про»): the time pinned for
 * them, what is next, and the two things to do — end it, or resume it after a
 * hold ran out unpaid. Shown only when there is one.
 */
export function StandingTimes({
  practiceId,
  timeZone,
}: {
  practiceId: string;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const standing = useQuery(orpc.standing.mine.queryOptions());
  const [ending, setEnding] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.standing.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
    ]);

  const resume = useMutation({
    ...orpc.standing.resume.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.held > 0
          ? "Постоянное время возобновлено. Часть дат ждёт оплаты пакета."
          : "Постоянное время возобновлено",
      );
      await refresh();
    },
    onError: (error) =>
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось возобновить",
      ),
  });
  const end = useMutation({
    ...orpc.standing.end.mutationOptions(),
    onSuccess: async (result) => {
      setEnding(null);
      toast.success(
        result.kept > 0
          ? `Постоянное время отменено. Ближайшие записи остались: до них меньше, чем длится срок отмены.`
          : "Постоянное время отменено",
      );
      await refresh();
    },
    onError: (error) =>
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось отменить",
      ),
  });

  const own = (standing.data ?? []).filter((s) => s.practiceId === practiceId);
  if (own.length === 0) return null;
  const target = own.find((s) => s.id === ending);

  return (
    <>
      {own.map((s) => (
        <Frame key={s.id} spacing="default">
          <FramePanel className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <PinIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium first-letter:uppercase">
                  {describeStanding(s.startsAt, s.intervalWeeks, timeZone)}
                  {s.paused ? (
                    <Badge variant="warning-light">
                      <PauseIcon aria-hidden="true" />
                      На паузе
                    </Badge>
                  ) : (
                    <Badge variant="success-light">Постоянное время</Badge>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {s.paused
                    ? "Неоплаченные даты освободились. Оплатите пакет и возобновите."
                    : s.nextAt
                      ? `Ближайшая запись — ${formatDateTime(s.nextAt, timeZone)}`
                      : "Новые даты появятся в ближайшие дни"}
                </span>
                {s.unpaid > 0 && !s.paused && (
                  <span className="text-sm text-muted-foreground">
                    Пакет закончился: {s.unpaid} дат ждут оплаты, пока время
                    держится за вами.
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {s.paused && (
                <Button
                  className="sm:flex-1"
                  disabled={resume.isPending}
                  onClick={() => resume.mutate({ standingId: s.id })}
                >
                  Возобновить
                </Button>
              )}
              <Button
                variant="outline"
                className="sm:flex-1"
                onClick={() => setEnding(s.id)}
              >
                Отменить постоянное время
              </Button>
            </div>
          </FramePanel>
        </Frame>
      ))}

      <Dialog open={!!target} onOpenChange={(open) => !open && setEnding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Отменить постоянное время?</DialogTitle>
            <DialogDescription>
              Новые записи делаться не будут. Будущие записи отменятся, а
              занятия вернутся на баланс, если до встречи больше срока отмены.
              Ближайшие записи останутся — их можно отменить по одной.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnding(null)}>
              Оставить
            </Button>
            <Button
              variant="destructive"
              disabled={end.isPending}
              onClick={() => target && end.mutate({ standingId: target.id })}
            >
              Отменить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { Button, Skeleton } from "@synoro/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  addDays,
  formatWeekRange,
  weekStart,
  weekWindow,
} from "./booking-views";
import { ErrorState } from "./states";
import { dateKey, formatTime } from "./time";

/**
 * Free times of one week, grouped by day in `timeZone` (the viewer's when
 * omitted), from `booking.slots`. For picking a new time in a dialog; the
 * booking page has its own, roomier layouts.
 */
export function SlotPicker({
  practiceId,
  kind,
  timeZone,
  selected,
  onSelect,
  disabled,
}: {
  practiceId: string;
  kind: "consultation" | "free";
  timeZone?: string;
  selected: Date | null;
  onSelect: (startsAt: Date) => void;
  disabled?: boolean;
}) {
  const today = dateKey(new Date(), timeZone);
  const thisWeek = weekStart(today);
  const [week, setWeek] = useState(thisWeek);
  // The padding of `weekWindow` also covers the practice's «today» being
  // another day than the viewer's.
  const slots = useQuery({
    ...orpc.booking.slots.queryOptions({
      input: { practiceId, kind, ...weekWindow(week, today) },
    }),
    placeholderData: (previous) => previous,
  });

  const lastDay = addDays(week, 6);
  const byDay = new Map<string, Date[]>();
  for (const { startsAt } of slots.data?.slots ?? []) {
    const key = dateKey(startsAt, timeZone);
    if (key < week || key > lastDay || key < today) continue;
    byDay.set(key, [...(byDay.get(key) ?? []), startsAt]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Предыдущая неделя"
          disabled={week <= thisWeek}
          onClick={() => setWeek(addDays(week, -7))}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm font-medium tabular-nums">
          {formatWeekRange(week)}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Следующая неделя"
          onClick={() => setWeek(addDays(week, 7))}
        >
          <ChevronRightIcon />
        </Button>
      </div>

      {slots.isError ? (
        <ErrorState onRetry={() => slots.refetch()} />
      ) : slots.isPending ? (
        <Skeleton className="h-32 w-full rounded-md" />
      ) : byDay.size === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          На этой неделе свободного времени нет. Посмотрите следующую.
        </p>
      ) : (
        // A week of times is long: it scrolls, the dialog's buttons stay in view.
        <div className="-m-1 flex max-h-[45dvh] flex-col gap-3 overflow-y-auto p-1">
          {[...byDay.entries()].map(([key, starts]) => (
            <section key={key} className="flex flex-col gap-1.5">
              <h3 className="text-sm text-muted-foreground first-letter:uppercase">
                {starts[0]?.toLocaleDateString("ru-RU", {
                  timeZone,
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
                {starts.map((startsAt) => {
                  const picked = selected?.getTime() === startsAt.getTime();
                  return (
                    <Button
                      key={startsAt.toISOString()}
                      variant={picked ? "default" : "outline"}
                      size="sm"
                      className="tabular-nums"
                      aria-pressed={picked}
                      // Times of another week while these load.
                      disabled={disabled || slots.isPlaceholderData}
                      onClick={() => onSelect(startsAt)}
                    >
                      {formatTime(startsAt, timeZone)}
                    </Button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

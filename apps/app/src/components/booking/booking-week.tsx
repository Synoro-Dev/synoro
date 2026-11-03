"use client";

import { Button, cn, Skeleton } from "@synoro/ui";

import { hourSpan } from "./booking-views";
import { formatTime, minutesToTime } from "./time";

type Slot = { startsAt: Date; endsAt: Date };

interface WeekProps {
  /** Monday to Sunday, in the viewer's zone. */
  days: readonly string[];
  byDay: ReadonlyMap<string, Slot[]>;
  /** The viewer's today: earlier days are dimmed. */
  today: string;
  disabled: boolean;
  onPick: (slot: Slot) => void;
}

const keyToDate = (key: string) => new Date(`${key}T12:00:00`);

/** «пн 3» over each column; today's number sits in an accent circle. */
function DayHeading({ day, today }: { day: string; today: string }) {
  const date = keyToDate(day);
  return (
    <div
      aria-current={day === today ? "date" : undefined}
      className={cn(
        "flex flex-col items-center gap-0.5 py-2",
        day < today && "text-muted-foreground",
      )}
    >
      <span className="text-xs text-muted-foreground">
        {date.toLocaleDateString("ru-RU", { weekday: "short" })}
      </span>
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-sm font-medium tabular-nums",
          day === today && "bg-primary text-primary-foreground",
        )}
      >
        {date.getDate()}
      </span>
    </div>
  );
}

function SlotButton({
  slot,
  disabled,
  onPick,
  size,
  className,
}: {
  slot: Slot;
  disabled: boolean;
  onPick: (slot: Slot) => void;
  size: "sm" | "default";
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size={size}
      disabled={disabled}
      onClick={() => onPick(slot)}
      aria-label={slot.startsAt.toLocaleString("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })}
      className={cn("w-full tabular-nums", className)}
    >
      {formatTime(slot.startsAt)}
    </Button>
  );
}

/**
 * The week as a timetable: a row per hour, a column per day, each free time
 * in its hour's cell — the same hour lines up across days. Rows run from the
 * earliest free hour of the week to the latest. With half-hour times (the
 * free intro) each cell has two halves, so a lone 15:30 sits low.
 */
export function WeekGrid({ days, byDay, today, disabled, onPick }: WeekProps) {
  const slots = days.flatMap((day) => byDay.get(day) ?? []);
  const halves = slots.some((slot) => slot.startsAt.getMinutes() !== 0);
  return (
    <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
      <div />
      {days.map((day) => (
        <DayHeading key={day} day={day} today={today} />
      ))}
      {hourSpan(slots.map((slot) => slot.startsAt)).map((hour) => (
        <HourRow
          key={hour}
          hour={hour}
          halves={halves}
          days={days}
          byDay={byDay}
          today={today}
          disabled={disabled}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function HourRow({
  hour,
  halves,
  days,
  byDay,
  today,
  disabled,
  onPick,
}: WeekProps & { hour: number; halves: boolean }) {
  return (
    <>
      <div className="-mt-2 pr-2 text-right text-xs text-muted-foreground tabular-nums">
        {minutesToTime(hour * 60)}
      </div>
      {days.map((day) => (
        <div
          key={day}
          className={cn(
            "grid min-h-12 gap-1 border-t border-l p-1",
            halves && "grid-rows-2",
            day < today && "bg-muted/40 dark:bg-muted/20",
          )}
        >
          {(byDay.get(day) ?? [])
            .filter((slot) => slot.startsAt.getHours() === hour)
            .map((slot) => (
              <SlotButton
                key={slot.startsAt.toISOString()}
                slot={slot}
                disabled={disabled}
                onPick={onPick}
                size="sm"
                className={cn(
                  halves && slot.startsAt.getMinutes() >= 30 && "row-start-2",
                )}
              />
            ))}
        </div>
      ))}
    </>
  );
}

/** The week as seven columns of times, each day's list from the top. */
export function WeekColumns({
  days,
  byDay,
  today,
  disabled,
  onPick,
}: WeekProps) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const slots = byDay.get(day) ?? [];
        return (
          <div key={day} className="flex min-w-0 flex-col gap-2">
            <DayHeading day={day} today={today} />
            {slots.length > 0 ? (
              slots.map((slot) => (
                <SlotButton
                  key={slot.startsAt.toISOString()}
                  slot={slot}
                  disabled={disabled}
                  onPick={onPick}
                  size="default"
                />
              ))
            ) : (
              <p className="py-2 text-center text-xs text-muted-foreground">
                <span aria-hidden>—</span>
                <span className="sr-only">Нет свободного времени</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Seven columns of placeholder times while the week loads. */
export function WeekSkeleton() {
  return (
    <div className="grid grid-cols-7 gap-2">
      {["a", "b", "c", "d", "e", "f", "g"].map((column) => (
        <div key={column} className="flex flex-col gap-2">
          <Skeleton className="mx-auto my-2 h-11 w-8" />
          {["1", "2", "3", "4"].map((row) => (
            <Skeleton key={row} className="h-8" />
          ))}
        </div>
      ))}
    </div>
  );
}

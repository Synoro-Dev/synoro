"use client";

import { cn } from "@synoro/ui";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  GlobeIcon,
  LockIcon,
  VideoIcon,
} from "lucide-react";
import { useState } from "react";

import { Initials } from "./primitives";

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const weekdayNames = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];

/** November 2026 starts on a Sunday: six blanks in a Monday-first grid. */
const days = [
  ...Array.from({ length: 6 }, () => null),
  ...Array.from({ length: 30 }, (_, i) => i + 1),
];
const today = 10;
const fullyBooked = new Set([11, 17, 25]);
/** Monday = 0 … Sunday = 6. */
const weekday = (day: number) => (day + 5) % 7;
const isOpen = (day: number) =>
  day >= today && weekday(day) < 5 && !fullyBooked.has(day);

const times = ["09:00", "10:00", "11:00", "13:00", "15:00", "17:00"];
/** A stable, made-up pattern of taken hours, different for each day. */
const isTaken = (day: number, index: number) => (day * 3 + index) % 5 === 0;

const endOf = (time: string) => `${Number(time.slice(0, 2)) + 1}:00`;

const plural = new Intl.PluralRules("ru");
const windows = { one: "окно", few: "окна" } as Record<string, string>;
const freeLabel = (count: number) =>
  `${count} ${count === 1 ? "свободное" : "свободных"} ${windows[plural.select(count)] ?? "окон"}`;

/**
 * A practice's public booking page that the visitor can actually click
 * through: pick a day, pick a time, book. Nothing is sent anywhere.
 */
export function BookingDemo() {
  const [day, setDay] = useState(12);
  const [time, setTime] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  const dayLabel = `${weekdays[weekday(day)]}, ${day} ноября`;
  const free = times.filter((_, index) => !isTaken(day, index)).length;

  return (
    <div className="bg-background relative overflow-hidden rounded-2xl shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_2px_4px_rgb(0_0_0/0.03),0_32px_64px_-24px_rgb(0_0_0/0.22)]">
      <div className="text-muted-foreground flex h-9 items-center justify-center gap-1.5 border-b text-xs">
        <LockIcon className="size-3" />
        zapis.anna-ivanova.ru
      </div>

      <div className="flex items-center gap-3 border-b p-4 sm:px-5">
        <Initials name="Анна Смирнова" className="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs">Анна Смирнова</p>
          <p className="truncate font-medium">Индивидуальное занятие</p>
        </div>
        <ul className="text-muted-foreground hidden flex-col items-end gap-1 text-xs sm:flex">
          <li className="flex items-center gap-1.5">
            60 минут <ClockIcon className="size-3.5" />
          </li>
          <li className="flex items-center gap-1.5">
            Онлайн или очно <VideoIcon className="size-3.5" />
          </li>
        </ul>
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <p className="font-medium">Ноябрь 2026</p>
            <div className="text-muted-foreground flex gap-1">
              <span className="flex size-7 items-center justify-center rounded-md border opacity-50">
                <ChevronLeftIcon className="size-4" />
              </span>
              <span className="flex size-7 items-center justify-center rounded-md border">
                <ChevronRightIcon className="size-4" />
              </span>
            </div>
          </div>
          <div className="text-muted-foreground mt-4 grid grid-cols-7 text-center text-xs">
            {weekdays.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-sm">
            {days.map((value, index) => {
              if (value === null) {
                // biome-ignore lint/suspicious/noArrayIndexKey: static blanks
                return <span key={`blank-${index}`} />;
              }
              const open = isOpen(value);
              const selected = value === day;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={!open || booked}
                  aria-pressed={selected}
                  aria-label={`${value} ноября, ${weekdayNames[weekday(value)]}${open ? "" : ", нет окон"}`}
                  onClick={() => {
                    setDay(value);
                    setTime(null);
                  }}
                  className={cn(
                    "focus-visible:ring-ring/50 relative flex aspect-square items-center justify-center rounded-lg tabular-nums outline-none focus-visible:ring-3",
                    !open && "text-muted-foreground/45",
                    open &&
                      !selected &&
                      "bg-muted hover:bg-foreground/10 font-medium transition-colors",
                    selected && "bg-foreground text-background font-medium",
                  )}
                >
                  {value}
                  {value === today && (
                    <span
                      className={cn(
                        "absolute bottom-1 size-1 rounded-full",
                        selected ? "bg-background" : "bg-foreground",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-xs">
            <GlobeIcon className="size-3.5" />
            Время московское
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t p-4 sm:border-t-0 sm:border-l sm:p-5">
          <p className="text-sm font-medium">
            {dayLabel}
            <span className="text-muted-foreground block text-xs font-normal">
              {freeLabel(free)}
            </span>
          </p>
          <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-1">
            {times.map((value, index) => {
              const taken = isTaken(day, index);
              const selected = value === time;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={taken || booked}
                  aria-pressed={selected}
                  onClick={() => setTime(value)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex h-9 items-center justify-center rounded-lg border text-sm font-medium tabular-nums outline-none focus-visible:ring-3",
                    taken &&
                      "text-muted-foreground/50 bg-muted/50 border-transparent line-through",
                    !taken &&
                      !selected &&
                      "hover:border-foreground/40 transition-colors",
                    selected && "border-foreground ring-foreground ring-1",
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!time || booked}
            onClick={() => setBooked(true)}
            className="bg-foreground text-background focus-visible:ring-ring/50 disabled:bg-muted disabled:text-muted-foreground mt-auto flex h-9 items-center justify-center rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-3 sm:mt-3"
          >
            {time ? "Записаться" : "Выберите время"}
          </button>
        </div>
      </div>

      {booked && time && (
        <div
          role="status"
          className="bg-background animate-in fade-in absolute inset-x-0 top-9 bottom-0 flex items-center justify-center p-6 duration-200"
        >
          <div className="animate-in zoom-in-95 slide-in-from-bottom-2 flex max-w-xs flex-col items-center text-center duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
            <span className="flex size-11 items-center justify-center rounded-full bg-emerald-600 text-white">
              <CheckIcon className="size-5" />
            </span>
            <p className="mt-4 text-lg font-semibold tracking-tight">
              Запись подтверждена
            </p>
            <p className="mt-1 text-sm tabular-nums">
              {dayLabel}, {time}–{endOf(time)}
            </p>
            <p className="text-muted-foreground mt-3 text-sm text-pretty">
              Из пакета списано 1 занятие, осталось 6. Подтверждение пришло на
              почту, отменить запись можно за 24 часа до начала.
            </p>
            <button
              type="button"
              onClick={() => {
                setBooked(false);
                setTime(null);
              }}
              className="hover:bg-muted focus-visible:ring-ring/50 mt-5 h-9 rounded-full border px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3"
            >
              Выбрать другое время
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

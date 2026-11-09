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
import { useEffect, useState } from "react";

import { brand } from "~/lib/brand";
import type { ProfessionPage } from "~/lib/professions";

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
/** The day shown on load: every window is free. */
const initialDay = 24;
/** A stable, made-up pattern of taken hours, different for each day. */
const isTaken = (day: number, index: number) =>
  day !== initialDay && (day * 3 + index) % 5 === 0;

const endOf = (time: string) => `${Number(time.slice(0, 2)) + 1}:00`;

const plural = new Intl.PluralRules("ru");
const windows = { one: "окно", few: "окна" } as Record<string, string>;
const freeLabel = (count: number) =>
  `${count} ${count === 1 ? "свободное" : "свободных"} ${windows[plural.select(count)] ?? "окон"}`;

/**
 * Until the visitor touches the page it books a time by itself, in a loop:
 * the day rests, a time is picked, the booking is confirmed (the note takes
 * 600ms to come up and stays for 2.4s), and it starts over.
 */
type AutoStep = "day" | "aim" | "done";
const AUTO_TIME = "15:00";
const AUTO_NEXT = { day: "aim", aim: "done", done: "day" } as const;
const AUTO_HOLD = { day: 2000, aim: 1400, done: 600 + 2400 } as const;
const SETTLE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

/**
 * A practice's public booking page that the visitor can actually click
 * through: pick a day, pick a time, book. Nothing is sent anywhere.
 */
export function BookingDemo({ demo }: { demo?: ProfessionPage["demo"] }) {
  const [day, setDay] = useState(initialDay);
  const [time, setTime] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);
  /** `null` once the visitor has taken over: the loop never comes back. */
  const [auto, setAuto] = useState<AutoStep | null>("day");

  useEffect(() => {
    if (auto === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(() => setAuto(AUTO_NEXT[auto]), AUTO_HOLD[auto]);
    return () => clearTimeout(timer);
  }, [auto]);

  /** A time the loop is pointing at becomes the visitor's own pick. */
  const takeOver = () => {
    if (auto === "aim") setTime(AUTO_TIME);
    setAuto(null);
  };
  const autoPicked = auto === "aim" ? AUTO_TIME : null;
  const autoBooked = auto === "done";

  const dayLabel = `${weekdays[weekday(day)]}, ${day} ноября`;
  const free =
    times.filter((_, index) => !isTaken(day, index)).length -
    (autoBooked ? 1 : 0);

  return (
    <div
      onPointerEnter={takeOver}
      onPointerDownCapture={takeOver}
      onFocusCapture={takeOver}
      className="bg-background relative overflow-hidden rounded-2xl shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_2px_4px_rgb(0_0_0/0.03),0_32px_64px_-24px_rgb(0_0_0/0.22)]"
    >
      <div className="text-muted-foreground flex h-9 items-center justify-center gap-1.5 border-b text-xs">
        <LockIcon className="size-3" />
        {demo?.host ?? `${brand.rootDomain}/anna`}
      </div>

      <div className="flex items-center gap-3 border-b p-4 sm:px-5">
        <Initials
          name={demo?.name ?? "Анна Миронова"}
          className="size-10 text-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs">
            {demo?.name ?? "Анна Миронова"}
          </p>
          <p className="truncate font-medium">
            {demo?.service ?? "Индивидуальное занятие"}
          </p>
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
            <span
              key={free}
              className="text-muted-foreground animate-in fade-in block text-xs font-normal duration-600"
            >
              {freeLabel(free)}
            </span>
          </p>
          <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-1">
            {times.map((value, index) => {
              const taken = isTaken(day, index);
              // The loop's own booking only looks taken: a click still lands.
              const struck = taken || (autoBooked && value === AUTO_TIME);
              const selected = value === (time ?? autoPicked);
              return (
                <button
                  key={value}
                  type="button"
                  disabled={taken || booked}
                  aria-pressed={value === time}
                  onClick={() => setTime(value)}
                  className={cn(
                    "focus-visible:ring-ring/50 flex h-9 items-center justify-center rounded-lg border text-sm font-medium tabular-nums outline-none transition-[color,background-color,border-color,box-shadow,scale] focus-visible:ring-3",
                    SETTLE,
                    struck &&
                      "text-muted-foreground/50 bg-muted/50 border-transparent line-through",
                    !struck && !selected && "hover:border-foreground/40",
                    selected && "border-foreground ring-foreground ring-1",
                    selected && autoPicked && "scale-[1.02]",
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
            className={cn(
              "bg-foreground text-background focus-visible:ring-ring/50 disabled:bg-muted disabled:text-muted-foreground mt-auto flex h-9 items-center justify-center rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-3 sm:mt-3",
              autoPicked && "disabled:bg-foreground disabled:text-background",
            )}
          >
            {(time ?? autoPicked) ? "Записаться" : "Выберите время"}
          </button>
        </div>
      </div>

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-3 bottom-3 flex justify-center transition-[opacity,translate] duration-600",
          SETTLE,
          !autoBooked && "translate-y-2 opacity-0",
        )}
      >
        <p className="bg-background flex items-center gap-2.5 rounded-xl border py-2 pr-4 pl-2 text-sm shadow-lg">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <CheckIcon className="size-4" />
          </span>
          <span>
            <span className="block font-medium">Запись подтверждена</span>
            <span className="text-muted-foreground block text-xs tabular-nums">
              {weekdays[weekday(initialDay)]}, {initialDay} ноября, {AUTO_TIME}{" "}
              · письмо отправлено
            </span>
          </span>
        </p>
      </div>

      {booked && time && (
        <div
          role="status"
          className="bg-background animate-in fade-in absolute inset-x-0 top-9 bottom-0 flex items-center justify-center p-6 duration-400"
        >
          <div className="animate-in zoom-in-95 slide-in-from-bottom-2 flex max-w-xs flex-col items-center text-center duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]">
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
              {demo
                ? `В пакете осталось 6 ${demo.many}.`
                : "Из пакета списано 1 занятие, осталось 6."}{" "}
              Подтверждение пришло на почту, отменить запись можно за 24 часа до
              начала.
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

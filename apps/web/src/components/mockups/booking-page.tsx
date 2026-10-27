import { cn } from "@synoro/ui";
import {
  BellIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  GlobeIcon,
  LockIcon,
  VideoIcon,
} from "lucide-react";

import { Initials } from "~/components/landing/primitives";

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** November 2026 starts on a Sunday: six blanks in a Monday-first grid. */
const days = [
  ...Array.from({ length: 6 }, () => null),
  ...Array.from({ length: 30 }, (_, i) => i + 1),
];
const today = 10;
const selected = 12;
const fullyBooked = new Set([11, 17]);
/** Monday = 0 … Sunday = 6. */
const isWeekend = (day: number) => (day + 5) % 7 >= 5;

const slots = [
  { time: "09:00", state: "free" },
  { time: "10:00", state: "free" },
  { time: "11:00", state: "taken" },
  { time: "13:00", state: "selected" },
  { time: "15:00", state: "free" },
  { time: "17:00", state: "free" },
] as const;

function BrowserChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background overflow-hidden rounded-xl shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_24px_48px_-12px_rgb(0_0_0/0.18)]">
      <div className="bg-muted/60 flex h-10 items-center gap-3 border-b px-4">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-zinc-300" />
          <span className="size-2.5 rounded-full bg-zinc-300" />
          <span className="size-2.5 rounded-full bg-zinc-300" />
        </div>
        <div className="bg-background text-muted-foreground mx-auto flex h-6 w-full max-w-64 items-center justify-center gap-1.5 rounded-md border text-xs">
          <LockIcon className="size-3" />
          zapis.anna-psy.ru
        </div>
        <div className="w-10" />
      </div>
      {children}
    </div>
  );
}

function Profile() {
  return (
    <div className="hidden flex-col gap-5 border-r p-6 lg:flex">
      <Initials
        name="Анна Смирнова"
        className="size-12 from-violet-100 to-sky-100 text-sm text-violet-700"
      />
      <div>
        <p className="text-muted-foreground text-xs">Анна Смирнова</p>
        <p className="mt-1 text-lg leading-tight font-medium">
          Индивидуальная консультация
        </p>
      </div>
      <ul className="text-muted-foreground flex flex-col gap-2.5 text-sm">
        <li className="flex items-center gap-2">
          <ClockIcon className="size-4" /> 60 минут
        </li>
        <li className="flex items-center gap-2">
          <VideoIcon className="size-4" /> Онлайн или очно
        </li>
        <li className="flex items-center gap-2">
          <GlobeIcon className="size-4" /> Москва (UTC+3)
        </li>
      </ul>
      <div className="bg-muted/60 mt-1 rounded-lg border p-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Ваш пакет</span>
          <span className="font-medium">7 из 10</span>
        </div>
        <div className="bg-border mt-2 h-1.5 overflow-hidden rounded-full">
          <div className="h-full w-[70%] rounded-full bg-violet-500" />
        </div>
      </div>
    </div>
  );
}

function Calendar() {
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <p className="font-medium">Ноябрь 2026</p>
        <div className="flex gap-1">
          <span className="text-muted-foreground flex size-7 items-center justify-center rounded-md border">
            <ChevronLeftIcon className="size-4" />
          </span>
          <span className="flex size-7 items-center justify-center rounded-md border">
            <ChevronRightIcon className="size-4" />
          </span>
        </div>
      </div>
      <div className="text-muted-foreground mt-5 grid grid-cols-7 text-center text-xs">
        {weekdays.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-sm">
        {days.map((day, index) => {
          if (day === null) {
            // biome-ignore lint/suspicious/noArrayIndexKey: static blanks
            return <span key={`blank-${index}`} />;
          }
          const past = day < today;
          const available = !past && !isWeekend(day) && !fullyBooked.has(day);
          return (
            <span
              key={day}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-lg tabular-nums",
                past && "text-muted-foreground/50",
                !past && !available && "text-muted-foreground",
                available && "bg-muted font-medium",
                day === selected &&
                  "bg-foreground text-background shadow-sm ring-0",
              )}
            >
              {day}
              {day === today && (
                <span className="absolute bottom-1 size-1 rounded-full bg-violet-500" />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Slots() {
  return (
    <div className="flex flex-col gap-2 border-t p-5 sm:p-6 md:border-t-0 md:border-l">
      <p className="text-sm font-medium">
        Чт, 12 ноября
        <span className="text-muted-foreground font-normal"> · 5 окон</span>
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-1">
        {slots.map((slot) => (
          <span
            key={slot.time}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border text-sm font-medium tabular-nums",
              slot.state === "taken" &&
                "text-muted-foreground/60 bg-muted/50 line-through",
              slot.state === "selected" &&
                "border-violet-500 bg-violet-50 text-violet-700 ring-2 ring-violet-500/20",
            )}
          >
            {slot.time}
          </span>
        ))}
      </div>
      <span className="bg-foreground text-background mt-auto flex h-9 items-center justify-center rounded-lg text-sm font-medium">
        Записаться
      </span>
    </div>
  );
}

/** Static picture of a practice's public booking page, used in the hero. */
export function BookingPageMockup() {
  return (
    <div className="relative">
      <BrowserChrome>
        <div className="grid md:grid-cols-[1fr_200px] lg:grid-cols-[260px_1fr_210px]">
          <Profile />
          <Calendar />
          <Slots />
        </div>
      </BrowserChrome>

      <div className="animate-float bg-background absolute -top-6 -right-4 hidden w-72 rounded-xl border p-3.5 shadow-xl shadow-black/5 md:block lg:-right-10">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <CheckIcon className="size-4" />
          </span>
          <div className="text-sm">
            <p className="font-medium">Запись подтверждена</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Чт, 12 нояб, 13:00 · списана 1 консультация из пакета
            </p>
          </div>
        </div>
      </div>

      <div className="animate-float bg-background absolute -bottom-6 -left-4 hidden w-72 rounded-xl border p-3.5 shadow-xl shadow-black/5 [animation-delay:-3s] md:block lg:-left-10">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
            <BellIcon className="size-4" />
          </span>
          <div className="text-sm">
            <p className="font-medium">Новая запись</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Ольга Петрова — пт, 13 нояб, 10:00
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

import { cn } from "@synoro/ui";
import {
  CheckIcon,
  LayersIcon,
  ShieldCheckIcon,
  UndoIcon,
  UserRoundIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { Eyebrow, IconTile, Initials, Section } from "./primitives";

function Card({
  className,
  title,
  text,
  children,
}: {
  className?: string;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col overflow-hidden", className)}>
      <div className="flex flex-col gap-1.5 p-6 sm:p-8">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm text-pretty">{text}</p>
      </div>
      <div className="bg-muted/50 relative flex min-h-60 flex-1 items-center justify-center overflow-hidden border-t p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}

const ledger = [
  { delta: "+10", label: "Пакет из 10 консультаций", date: "1 нояб" },
  { delta: "−1", label: "Запись на 5 нояб, 10:00", date: "3 нояб" },
  { delta: "+1", label: "Отмена за 2 дня — возврат", date: "4 нояб" },
  { delta: "−1", label: "Запись на 12 нояб, 13:00", date: "10 нояб" },
];

function CreditsVisual() {
  return (
    <div className="bg-background w-full max-w-md rounded-xl border shadow-sm">
      <div className="flex items-center gap-4 border-b p-4">
        <Initials name="Ольга Петрова" />
        <div className="flex-1">
          <p className="text-sm font-medium">Ольга Петрова</p>
          <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
            <div className="h-full w-[90%] rounded-full bg-linear-to-r from-violet-500 to-sky-400" />
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl leading-none font-medium tabular-nums">9</p>
          <p className="text-muted-foreground text-xs">на балансе</p>
        </div>
      </div>
      <ul className="divide-y">
        {ledger.map((entry) => (
          <li
            key={entry.label}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <span
              className={cn(
                "w-8 font-mono text-xs font-medium tabular-nums",
                entry.delta.startsWith("+")
                  ? "text-emerald-600"
                  : "text-zinc-500",
              )}
            >
              {entry.delta}
            </span>
            <span className="flex-1 truncate">{entry.label}</span>
            <span className="text-muted-foreground text-xs">{entry.date}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConflictVisual() {
  return (
    <div className="flex w-full max-w-60 flex-col gap-2.5">
      <div className="bg-background flex items-center gap-2.5 rounded-lg border p-2.5 text-sm shadow-sm">
        <Initials name="Наталья Волкова" className="size-6 text-[10px]" />
        <span className="flex-1">Пт, 10:00</span>
        <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckIcon className="size-3" />
        </span>
      </div>
      <div className="bg-background flex items-center gap-2.5 rounded-lg border p-2.5 text-sm opacity-70 shadow-sm">
        <Initials name="Алексей Кузнецов" className="size-6 text-[10px]" />
        <span className="text-muted-foreground flex-1 line-through">
          Пт, 10:00
        </span>
        <span className="flex size-5 items-center justify-center rounded-full bg-rose-500 text-white">
          <XIcon className="size-3" />
        </span>
      </div>
      <p className="text-muted-foreground text-center text-xs">
        две заявки в одну секунду
      </p>
    </div>
  );
}

function CancelVisual() {
  return (
    <div className="w-full max-w-64">
      <div className="text-muted-foreground mb-2 flex justify-between text-xs">
        <span>сейчас</span>
        <span>−24 ч</span>
        <span>сеанс</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        <div className="flex-[3] bg-emerald-400" />
        <div className="flex-1 bg-zinc-300" />
      </div>
      <div className="mt-4 flex flex-col gap-2 text-xs">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400" />
          Отменяет сам — консультация вернётся
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-zinc-300" />
          Позже — только через специалиста
        </span>
      </div>
    </div>
  );
}

const team = [
  { name: "Андрей Клюев", role: "Владелец", tone: "bg-zinc-900 text-white" },
  {
    name: "Мария Соколова",
    role: "Админ",
    tone: "bg-sky-50 text-sky-700",
  },
  {
    name: "Екатерина Смирнова",
    role: "Клиент",
    tone: "bg-muted text-muted-foreground",
  },
];

function TeamVisual() {
  return (
    <div className="flex w-full max-w-72 flex-col gap-2">
      {team.map((member) => (
        <div
          key={member.name}
          className="bg-background flex items-center gap-2.5 rounded-lg border p-2 pr-2.5 shadow-sm"
        >
          <Initials name={member.name} className="size-7 text-[10px]" />
          <span className="flex-1 truncate text-sm">{member.name}</span>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-xs font-medium",
              member.tone,
            )}
          >
            {member.role}
          </span>
        </div>
      ))}
    </div>
  );
}

function CabinetVisual() {
  return (
    <div className="bg-background w-full max-w-64 rounded-xl border p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Мои записи</p>
        <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">
          7 консультаций
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {["Чт, 12 нояб · 13:00", "Чт, 19 нояб · 13:00"].map((when) => (
          <div
            key={when}
            className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs"
          >
            <span className="tabular-nums">{when}</span>
            <span className="text-muted-foreground underline underline-offset-2">
              Отменить
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Bento() {
  return (
    <Section>
      <div className="flex flex-col items-center gap-5 px-4 pt-16 pb-12 text-center sm:px-10 sm:pt-24">
        <Eyebrow icon={LayersIcon} tone="emerald">
          Всё для частной практики
        </Eyebrow>
        <h2 className="max-w-2xl text-3xl font-medium tracking-tight text-balance sm:text-4xl md:text-5xl">
          Оплата, отмены и команда уже продуманы
        </h2>
      </div>

      <div className="grid border-t md:grid-cols-6 [&>*]:border-b md:[&>*]:border-r md:[&>*:nth-child(2)]:border-r-0 md:[&>*:nth-child(5)]:border-r-0 md:[&>*:nth-child(n+3)]:border-b-0 [&>*:last-child]:border-b-0">
        <Card
          className="md:col-span-4"
          title="Пакеты консультаций"
          text="Клиент платит переводом или онлайн через ЮKassa — тогда консультации начислятся сами. Каждая запись списывает одну, своевременная отмена — возвращает. Вся история в журнале."
        >
          <CreditsVisual />
        </Card>
        <Card
          className="md:col-span-2"
          title="Ни одной двойной записи"
          text="Даже если двое нажмут «Записаться» в одну секунду, слот достанется только одному — это гарантирует сама база данных."
        >
          <ConflictVisual />
        </Card>
        <Card
          className="md:col-span-2"
          title="Отмена без звонков"
          text="Клиент сам отменяет запись за 24 часа и раньше — консультация вернётся на баланс автоматически."
        >
          <CancelVisual />
        </Card>
        <Card
          className="md:col-span-2"
          title="Администратор в команде"
          text="Помощник ведёт расписание, начисляет пакеты и записывает на знакомство. Вы — консультируете."
        >
          <TeamVisual />
        </Card>
        <Card
          className="md:col-span-2"
          title="Кабинет клиента"
          text="Клиент входит по коду из письма, видит свои записи и сколько консультаций осталось."
        >
          <CabinetVisual />
        </Card>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t px-4 py-6 text-sm">
        <span className="flex items-center gap-2">
          <IconTile icon={ShieldCheckIcon} tone="emerald" />
          Приглашения с подтверждением email
        </span>
        <span className="flex items-center gap-2">
          <IconTile icon={UndoIcon} tone="amber" />
          Возвраты и ручные корректировки
        </span>
        <span className="flex items-center gap-2">
          <IconTile icon={UsersIcon} tone="sky" />
          Список клиентов с балансами
        </span>
        <span className="flex items-center gap-2">
          <IconTile icon={UserRoundIcon} tone="violet" />
          Вход по email-коду или Google
        </span>
      </div>
    </Section>
  );
}

import { cn } from "@synoro/ui";
import {
  CheckIcon,
  ShieldCheckIcon,
  UndoIcon,
  UserRoundIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { IconTile, Initials, Section, SectionHeading } from "./primitives";

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
  { delta: "+10", label: "Пакет из 10 занятий", date: "4 нояб" },
  { delta: "−1", label: "Запись на 12 нояб, 10:00", date: "8 нояб" },
  { delta: "−1", label: "Запись на 16 нояб, 13:00", date: "12 нояб" },
  {
    delta: "−1/+1",
    label: "Отмена за 2 дня — занятие вернулось",
    date: "16 нояб",
  },
];

function CreditsVisual() {
  return (
    <div className="bg-background w-full max-w-md rounded-xl border shadow-sm">
      <div className="flex items-center gap-4 border-b p-4">
        <Initials name="Вера Тихонова" />
        <div className="flex-1">
          <p className="text-sm font-medium">Вера Тихонова</p>
          <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
            <div className="bg-foreground h-full w-[80%] rounded-full" />
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl leading-none font-medium tabular-nums">8</p>
          <p className="text-muted-foreground text-xs">осталось</p>
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
                "w-10 shrink-0 font-mono text-xs font-medium tabular-nums",
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
        <Initials name="Любовь Ясенева" className="size-6 text-[10px]" />
        <span className="flex-1">Пт, 10:00</span>
        <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckIcon className="size-3" />
        </span>
      </div>
      <div className="bg-background flex items-center gap-2.5 rounded-lg border p-2.5 text-sm opacity-70 shadow-sm">
        <Initials name="Марк Заречный" className="size-6 text-[10px]" />
        <span className="text-muted-foreground flex-1 line-through">
          Пт, 10:00
        </span>
        <span className="flex size-5 items-center justify-center rounded-full bg-rose-500 text-white">
          <XIcon className="size-3" />
        </span>
      </div>
      <p className="text-muted-foreground text-center text-xs">
        двое выбрали одно время
      </p>
    </div>
  );
}

const notices = [
  {
    channel: "TG",
    title: "Новая запись · Вера Тихонова",
    note: "Вт, 24 нояб · 13:00",
    fresh: true,
  },
  {
    channel: "MAX",
    title: "Напоминание клиенту отправлено",
    note: "За 1 час до начала",
    fresh: false,
  },
];

function MessengerVisual() {
  return (
    <div className="flex w-full max-w-80 flex-col gap-2.5">
      {notices.map((notice) => (
        <div
          key={notice.channel}
          className="bg-background flex items-center gap-2.5 rounded-lg border p-2.5 shadow-sm"
        >
          <span className="bg-muted shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium">
            {notice.channel}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{notice.title}</p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {notice.note}
            </p>
          </div>
          {notice.fresh && (
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
          )}
        </div>
      ))}
    </div>
  );
}

function CancelVisual() {
  return (
    <div className="w-full max-w-64">
      <div className="text-muted-foreground mb-2 flex justify-between text-xs">
        <span>сейчас</span>
        <span>за 24 часа</span>
        <span>занятие</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        <div className="flex-[3] bg-emerald-400" />
        <div className="flex-1 bg-zinc-300" />
      </div>
      <div className="mt-4 flex flex-col gap-2 text-xs">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400" />
          Отменяет сам — занятие вернётся
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-zinc-300" />
          Позже — только через специалиста
        </span>
      </div>
    </div>
  );
}

const owner = { name: "Анна Миронова", note: "Работает с клиентами" };

/** Who takes the routine off the owner: shown below, branching from them. */
const around = [
  {
    name: "София Белозерская",
    role: "Администратор",
    tone: "ring-border ring-1 ring-inset",
  },
  {
    name: "Вера Тихонова",
    role: "Клиент",
    tone: "bg-muted text-muted-foreground",
  },
];

function TeamVisual() {
  return (
    <div className="flex w-full max-w-80 flex-col items-center">
      <div className="bg-background flex items-center gap-3 rounded-xl border p-3 pr-3.5 shadow-sm">
        <Initials name={owner.name} className="size-10 text-sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{owner.name}</p>
          <p className="text-muted-foreground text-xs">{owner.note}</p>
        </div>
        <span className="bg-foreground text-background rounded-md px-1.5 py-0.5 text-xs font-medium">
          Владелец
        </span>
      </div>
      <span aria-hidden className="bg-border h-3 w-px" />
      <span aria-hidden className="h-3 w-1/2 rounded-t-lg border-x border-t" />
      <div className="grid w-full grid-cols-2 gap-2">
        {around.map((member) => (
          <div
            key={member.name}
            className="bg-background flex min-w-0 flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center shadow-sm"
          >
            <Initials name={member.name} className="size-7 text-[10px]" />
            <p className="w-full truncate text-xs">{member.name}</p>
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
    </div>
  );
}

function CabinetVisual() {
  return (
    <div className="bg-background w-full max-w-64 rounded-xl border p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Мои записи</p>
        <span className="bg-muted rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums">
          Осталось 8
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {["Вт, 24 нояб · 13:00", "Чт, 26 нояб · 13:00"].map((when) => (
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
      <div className="flex flex-col items-center px-4 pt-16 pb-12 text-center sm:px-10 sm:pt-24">
        <SectionHeading className="max-w-2xl">
          Оплата, отмены и команда уже продуманы
        </SectionHeading>
      </div>

      <div className="grid border-t md:grid-cols-6 [&>*]:border-b md:[&>*]:border-r md:[&>*:nth-child(even)]:border-r-0 md:[&>*:nth-child(n+5)]:border-b-0 [&>*:last-child]:border-b-0">
        <Card
          className="md:col-span-4"
          title="Пакеты с предоплатой"
          text="Клиент платит заранее за несколько занятий — переводом или картой онлайн. Оплату онлайн («Про») система учтёт сама, перевод вы или администратор отметите вручную. Каждая запись уменьшает остаток, а отмена вовремя возвращает занятие. Вся история — в одном списке."
        >
          <CreditsVisual />
        </Card>
        <Card
          className="md:col-span-2"
          title="Ни одной двойной записи"
          text="Если двое одновременно выберут одно время, запись получит только один. Второй сразу увидит, что время занято."
        >
          <ConflictVisual />
        </Card>
        <Card
          className="md:col-span-3"
          title="Напоминания в Telegram и MAX"
          text="Клиент вовремя получит напоминание о встрече со ссылкой на созвон, а вы — мгновенное уведомление о новой записи или отмене. В Telegram и MAX — на тарифе «Про» и с подключённым ботом, иначе на почту."
        >
          <MessengerVisual />
        </Card>
        <Card
          className="md:col-span-3"
          title="Отмена без звонков"
          text="Клиент сам отменяет запись не позднее чем за 24 часа — занятие вернётся в пакет автоматически."
        >
          <CancelVisual />
        </Card>
        <Card
          className="md:col-span-3"
          title="Администратор в команде"
          text="Помощник ведёт расписание, добавляет занятия в пакеты и записывает новых клиентов на бесплатную встречу, а вы занимаетесь клиентами."
        >
          <TeamVisual />
        </Card>
        <Card
          className="md:col-span-3"
          title="Кабинет клиента"
          text="Клиент входит по коду из письма и видит свои записи и сколько занятий осталось."
        >
          <CabinetVisual />
        </Card>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t px-4 py-6 text-sm">
        <span className="flex items-center gap-2">
          <IconTile icon={ShieldCheckIcon} />
          Приглашения помощников по почте
        </span>
        <span className="flex items-center gap-2">
          <IconTile icon={UndoIcon} />
          Возврат занятий и ручные поправки
        </span>
        <span className="flex items-center gap-2">
          <IconTile icon={UsersIcon} />
          Список клиентов с остатком занятий
        </span>
        <span className="flex items-center gap-2">
          <IconTile icon={UserRoundIcon} />
          Клиенту не нужен пароль — вход по коду из письма
        </span>
      </div>
    </Section>
  );
}

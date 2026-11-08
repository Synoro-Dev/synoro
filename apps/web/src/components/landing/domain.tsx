"use client";

import { cn } from "@synoro/ui";
import {
  CheckIcon,
  ClockIcon,
  GlobeIcon,
  LockIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";

import { brand } from "~/lib/brand";
import { paidPlan } from "~/lib/pricing";

import { Initials, Lead, Section, SectionHeading } from "./primitives";

const steps = [
  {
    title: "Выберите адрес",
    text: "Проще всего поддомен вашего сайта — например, zapis.anna-ivanova.ru. Домен нужно заранее купить у любого регистратора.",
  },
  {
    title: "Добавьте две записи",
    text: "Мы покажем их в настройках практики: одна подтверждает, что домен ваш, другая направляет его на страницу записи.",
  },
  {
    title: "Страница открывается у вас",
    text: "Когда записи появятся, мы сами проверим их и включим https. Это занимает несколько минут.",
  },
];

/** The two ways to connect, with the records the practice would see. */
const modes = [
  {
    id: "sub",
    label: "Поддомен",
    host: "zapis.anna-ivanova.ru",
    records: [
      { type: "CNAME", name: "zapis", value: `domains.${brand.rootDomain}` },
      {
        type: "TXT",
        name: "_booking-verification.zapis",
        value: "c2y4-9fq1-kd7a",
      },
    ],
    note: "Подходит любому регистратору.",
  },
  {
    id: "apex",
    label: "Домен целиком",
    host: "anna-ivanova.ru",
    records: [
      { type: "ALIAS", name: "@", value: `domains.${brand.rootDomain}` },
      {
        type: "TXT",
        name: "_booking-verification",
        value: "c2y4-9fq1-kd7a",
      },
    ],
    note: "Нужна запись ALIAS (у некоторых — ANAME). Если у регистратора её нет, подключите поддомен.",
  },
] as const;

function Slot({ children }: { children: string }) {
  return (
    <span className="bg-muted text-muted-foreground flex h-8 items-center justify-center rounded-lg border text-xs font-medium tabular-nums">
      {children}
    </span>
  );
}

/** A browser window: the address is the point, the page is a hint of it. */
function Browser({ host }: { host: string }) {
  return (
    <div className="bg-background overflow-hidden rounded-xl shadow-[0_0_0_1px_rgb(0_0_0/0.07),0_2px_4px_rgb(0_0_0/0.03),0_24px_48px_-24px_rgb(0_0_0/0.2)]">
      <div className="bg-muted/60 flex items-center gap-3 border-b px-3 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-zinc-300" />
          <span className="size-2.5 rounded-full bg-zinc-300" />
          <span className="size-2.5 rounded-full bg-zinc-300" />
        </span>
        <span
          key={host}
          className="bg-background text-foreground flex min-w-0 flex-1 animate-in items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs duration-300 fade-in-0 slide-in-from-bottom-1"
        >
          <LockIcon className="size-3 shrink-0 text-emerald-600" />
          <span className="truncate">{host}</span>
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Initials name="Анна Иванова" className="size-10 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs">Анна Иванова</p>
            <p className="truncate font-medium">Консультация психолога</p>
          </div>
          <p className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
            <ClockIcon className="size-3.5" />
            60 минут
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Slot>10:00</Slot>
          <Slot>12:00</Slot>
          <Slot>15:00</Slot>
        </div>
      </div>
    </div>
  );
}

function Records({ mode }: { mode: (typeof modes)[number] }) {
  return (
    <div className="bg-background overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <GlobeIcon className="text-muted-foreground size-4" />
        Что указать у регистратора
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-normal">Тип</th>
              <th className="px-4 py-2.5 font-normal">Имя</th>
              <th className="px-4 py-2.5 font-normal">Значение</th>
              <th className="w-8 px-4 py-2.5">
                <span className="sr-only">Статус</span>
              </th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {mode.records.map((record) => (
              <tr key={record.type} className="border-t">
                <td className="px-4 py-3">
                  <span className="bg-muted rounded-md border px-1.5 py-0.5">
                    {record.type}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{record.name}</td>
                <td className="px-4 py-3 whitespace-nowrap">{record.value}</td>
                <td className="px-4 py-3">
                  <CheckIcon
                    aria-label="Запись найдена"
                    className="size-3.5 text-emerald-600"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground flex items-center gap-2 border-t px-4 py-3 text-xs">
        <ShieldCheckIcon className="size-3.5 shrink-0 text-emerald-600" />
        Записи проверены — страница открывается по новому адресу
      </p>
    </div>
  );
}

export function Domain() {
  const [id, setId] = useState<(typeof modes)[number]["id"]>("sub");
  const mode = modes.find((item) => item.id === id) ?? modes[0];

  return (
    <Section
      id="domain"
      containerClassName="grid items-start gap-12 px-4 py-16 sm:px-10 sm:py-24 lg:grid-cols-[1fr_1.1fr] lg:gap-16"
    >
      <div className="flex flex-col gap-6">
        <p className="bg-muted text-muted-foreground flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
          <SparklesIcon className="size-3.5" />
          Входит в тариф «{paidPlan.name}»
        </p>
        <SectionHeading>Страница записи на вашем адресе</SectionHeading>
        <Lead>
          Начните со ссылки Synoro, а когда захотите — подключите собственный
          адрес. Клиент увидит ваше имя в адресной строке, а не наше.
        </Lead>

        <ol className="mt-2 flex flex-col">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className="bg-border absolute top-8 bottom-1 left-[13px] w-px"
                />
              )}
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                  index === steps.length - 1
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="text-muted-foreground mt-1 max-w-md text-sm text-pretty">
                  {step.text}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-muted-foreground max-w-md text-sm text-pretty">
          Вход клиента и оплата проходят на {brand.rootDomain}: так вам не нужно
          ничего настраивать, кроме двух записей.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <fieldset className="bg-muted m-0 flex w-fit min-w-0 gap-1 rounded-full border p-1">
          <legend className="sr-only">Как подключить адрес</legend>
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === id}
              onClick={() => setId(item.id)}
              className={cn(
                "focus-visible:ring-ring/50 rounded-full px-3.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-3",
                item.id === id
                  ? "bg-background text-foreground font-medium shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <Browser host={mode.host} />
        <Records mode={mode} />
        <p
          className="text-muted-foreground text-xs text-pretty"
          aria-live="polite"
        >
          {mode.note}
        </p>
      </div>
    </Section>
  );
}

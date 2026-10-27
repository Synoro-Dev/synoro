import {
  CalendarCogIcon,
  RocketIcon,
  Share2Icon,
  StoreIcon,
} from "lucide-react";

import { brand } from "~/lib/brand";

import { Eyebrow, Lead, Section, SectionHeading } from "./primitives";

const steps = [
  {
    icon: StoreIcon,
    title: "Создайте практику",
    text: "Название, адрес страницы и часовой пояс. Это займёт пару минут.",
    detail: `${brand.rootDomain}/p/anna`,
  },
  {
    icon: CalendarCogIcon,
    title: "Настройте расписание",
    text: "Рабочие часы по дням недели, перерывы и закрытое время.",
    detail: "Пн–Пт · 10:00–19:00",
  },
  {
    icon: Share2Icon,
    title: "Поделитесь ссылкой",
    text: "В соцсетях, мессенджерах, на визитке — или на своём домене.",
    detail: "Первая запись — уже сегодня",
  },
];

export function Steps() {
  return (
    <Section id="how">
      <div className="flex flex-col gap-5 px-4 pt-16 pb-12 sm:px-10 sm:pt-24">
        <Eyebrow icon={RocketIcon} tone="amber">
          Как начать
        </Eyebrow>
        <SectionHeading>Три шага до первой записи</SectionHeading>
        <Lead>
          Без внедрения и обучения: всё настраивается за один вечер, а клиенты
          разберутся с первого раза.
        </Lead>
      </div>
      <ol className="grid border-t md:grid-cols-3 md:divide-x">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="group relative flex flex-col gap-3 border-b p-6 last:border-b-0 sm:p-8 md:border-b-0"
          >
            <div className="flex items-center justify-between">
              <span className="bg-background flex size-10 items-center justify-center rounded-xl border shadow-xs">
                <step.icon className="size-5" />
              </span>
              <span className="font-mono text-5xl font-medium text-zinc-200 tabular-nums">
                0{index + 1}
              </span>
            </div>
            <p className="mt-4 text-lg font-medium">{step.title}</p>
            <p className="text-muted-foreground text-sm">{step.text}</p>
            <p className="bg-muted text-muted-foreground mt-auto w-fit rounded-md border px-2 py-1 font-mono text-xs">
              {step.detail}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

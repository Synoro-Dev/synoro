import { buttonVariants, cn } from "@synoro/ui";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CalendarRangeIcon,
  CoffeeIcon,
  HandshakeIcon,
} from "lucide-react";

import { BookingsListMockup } from "~/components/mockups/bookings-list";
import type { SiteLinks } from "~/lib/site";

import { Eyebrow, Lead, Section, SectionHeading } from "./primitives";

const points = [
  {
    icon: CalendarRangeIcon,
    title: "Рабочие часы по дням недели",
    text: "Задайте окна один раз — свободные слоты на месяц вперёд посчитаются сами.",
  },
  {
    icon: HandshakeIcon,
    title: "Знакомство на 30 минут",
    text: "Бесплатные консультации для новых клиентов — достаточно имени и контакта.",
  },
  {
    icon: CoffeeIcon,
    title: "Время для себя",
    text: "Закройте отпуск, супервизию или обед — на это время никто не запишется.",
  },
];

export function Scheduling({ links }: { links: SiteLinks }) {
  return (
    <Section id="features">
      <div className="flex flex-col gap-5 px-4 pt-16 pb-12 sm:px-10 sm:pt-24">
        <Eyebrow icon={CalendarClockIcon} tone="violet">
          Онлайн-запись
        </Eyebrow>
        <SectionHeading>
          Расписание, которое
          <br className="hidden sm:block" /> заполняется без вас
        </SectionHeading>
        <Lead>
          Клиент видит только свободные окна в вашем часовом поясе и
          записывается в пару кликов. Вы видите все записи, знакомства и
          закрытое время в одном календаре.
        </Lead>
        <a
          href={links.demo}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "mt-2 w-fit rounded-full px-4",
          )}
        >
          Посмотреть, как видит клиент
          <ArrowRightIcon data-icon="inline-end" />
        </a>
      </div>

      <div className="bg-muted/70 bg-dots relative border-y px-4 py-14 sm:px-10 sm:py-20">
        <BookingsListMockup />
      </div>

      <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {points.map((point) => (
          <div key={point.title} className="flex flex-col gap-2 p-6 sm:p-8">
            <point.icon className="text-muted-foreground size-5" />
            <p className="mt-2 font-medium">{point.title}</p>
            <p className="text-muted-foreground text-sm">{point.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

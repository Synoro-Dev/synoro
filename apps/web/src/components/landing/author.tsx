import { legal } from "@synoro/config";

import { paidPlan, rubles } from "~/lib/pricing";

import { Lead, Section, SectionHeading } from "./primitives";

export function Author() {
  const { operator } = legal;
  return (
    <Section id="author">
      <div className="grid items-center gap-10 px-4 py-16 sm:px-10 sm:py-24 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16">
        <figure className="flex flex-col gap-3">
          {/* biome-ignore lint/performance/noImgElement: a static file; the image optimizer's /_next/ is routed to the app on synoro.ru. */}
          <img
            src="/assets/founder.webp"
            width={1448}
            height={1086}
            alt="Максим Карпычев, основатель Synoro, за рабочим столом"
            loading="lazy"
            className="aspect-4/3 w-full rounded-2xl border object-cover object-top shadow-sm"
          />
          <figcaption className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Максим Карпычев</span>
            , основатель Synoro
          </figcaption>
        </figure>

        <div className="flex flex-col gap-5">
          <p className="text-muted-foreground text-sm">От основателя</p>
          <SectionHeading className="md:text-5xl">
            Я делаю Synoro, чтобы вы работали с людьми, а не с таблицами
          </SectionHeading>
          <Lead className="flex max-w-2xl flex-col gap-4 text-base sm:text-base">
            <span>
              Специалисту в частной практике не нужен ещё один «комбайн». Нужно
              спокойное расписание: клиент выбрал время, оплатил, получил
              напоминание — и никто не пишет вечером «а есть окошко в четверг?».
            </span>
            <span>
              Поэтому всё, что нужно для записи, в Synoro бесплатно, а с оплат
              клиентов мы не берём процент. «{paidPlan.name}» добавляет оплату
              онлайн, аналитику и свои сообщения клиентам:{" "}
              {rubles(paidPlan.monthly)} в месяц, первые {paidPlan.trialDays}{" "}
              дней бесплатно.
            </span>
            <span>
              Не получается настроить или нужно перенести клиентов из другого
              сервиса — напишите мне:{" "}
              <a
                href={`mailto:${operator.email}`}
                className="text-foreground underline underline-offset-4 transition-colors hover:opacity-70"
              >
                {operator.email}
              </a>
            </span>
          </Lead>
        </div>
      </div>
    </Section>
  );
}

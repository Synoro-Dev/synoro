import { legal } from "@synoro/config";
import { cn } from "@synoro/ui";

import { paidPlan, rubles } from "~/lib/pricing";

import { display, Lead, Section, SectionHeading } from "./primitives";

/** Each digit is one of the founder's numerology numbers; the fact is real. */
const principles = [
  {
    number: 4,
    title: "Фундамент",
    text: "Ни одной двойной записи, история каждого занятия, данные хранятся в России.",
  },
  {
    number: 6,
    title: "Забота",
    text: "Отмена без звонков, напоминания клиентам и время для себя в расписании.",
  },
  {
    number: 9,
    title: "Щедрость",
    text: "Бесплатно навсегда и без процента с оплат клиентов.",
  },
  {
    number: 7,
    title: "Глубина",
    text: "Аналитика практики: неявки, занятые часы и выручка — чтобы решать по цифрам.",
  },
];

export function Author() {
  const { operator } = legal;
  return (
    <Section id="author">
      <div className="grid items-center gap-10 px-4 pt-16 pb-12 sm:px-10 sm:pt-24 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16">
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
              Специалисту в частной практике нужен не очередной «комбайн», а
              спокойное расписание: клиент выбрал время, оплатил, получил
              напоминание — и никто не пишет вечером «а есть окошко в четверг?».
            </span>
            <span>
              Поэтому в Synoro бесплатно всё, что нужно для записи, и нет
              процента с ваших оплат. «{paidPlan.name}» нужен, чтобы клиенты
              платили сами: {rubles(paidPlan.monthly)} в месяц, первые{" "}
              {paidPlan.trialDays} дней бесплатно.
            </span>
            <span>
              Если что-то не получается или нужно перенести клиентов из другого
              сервиса — напишите мне:{" "}
              <a
                href={`mailto:${operator.email}`}
                className="text-foreground underline underline-offset-4 transition-colors hover:opacity-70"
              >
                {operator.email}
              </a>
              .
            </span>
          </Lead>
          <p className="text-muted-foreground text-xs">
            {operator.name}, ИНН {operator.inn}
          </p>
        </div>
      </div>
      <ol className="grid border-t sm:grid-cols-2 lg:grid-cols-4">
        {principles.map((item) => (
          <li
            key={item.title}
            className="flex flex-col gap-3 border-b p-6 last:border-b-0 sm:p-8 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-r lg:border-b-0 lg:last:border-r-0"
          >
            <span
              className={cn(
                display,
                "text-6xl leading-none text-zinc-200 tabular-nums",
              )}
            >
              {item.number}
            </span>
            <p className="mt-2 text-lg font-medium">{item.title}</p>
            <p className="text-muted-foreground text-sm text-pretty">
              {item.text}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

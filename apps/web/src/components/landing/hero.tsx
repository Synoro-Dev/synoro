import { buttonVariants, cn } from "@synoro/ui";

import { paidPlan, signupGoal } from "~/lib/pricing";
import type { ProfessionPage } from "~/lib/professions";
import type { SiteLinks } from "~/lib/site";

import { BookingDemo } from "./booking-demo";
import { Container, display } from "./primitives";

/** The home page's hero, or the one of a profession's page (`/solutions/<slug>`). */
export function Hero({
  links,
  page,
}: {
  links: SiteLinks;
  page?: ProfessionPage;
}) {
  const secondary = cn(
    buttonVariants({ variant: "outline", size: "lg" }),
    "h-11 rounded-full px-6 text-[15px]",
  );
  return (
    <section id="top" className="relative isolate overflow-hidden pt-16">
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_80%_70%_at_75%_10%,black_20%,transparent_70%)]"
      />
      <Container className="grid items-center gap-14 px-4 pt-14 pb-20 sm:px-10 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,33rem)] lg:gap-12 lg:pt-24 lg:pb-28">
        <div className="animate-fade-up flex flex-col items-start">
          <a
            href="#pricing"
            className="bg-background hover:bg-muted mb-7 inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm shadow-xs transition-colors"
          >
            <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white">
              0 ₽
            </span>
            Бесплатно навсегда, без лимита записей
          </a>

          <h1
            className={cn(
              display,
              "text-[2.75rem] leading-[0.98] tracking-[-0.045em] sm:text-6xl xl:text-[4.25rem]",
            )}
          >
            {page ? (
              <>
                <span className="block">{page.heading[0]}</span>
                <span className="block">{page.heading[1]}</span>
              </>
            ) : (
              <>
                <span className="block">Клиенты записываются сами.</span>
                <span className="block">Вы работаете с&nbsp;людьми.</span>
              </>
            )}
          </h1>

          <p className="text-muted-foreground mt-6 max-w-[34rem] text-lg text-pretty">
            {page
              ? page.lead
              : "Онлайн-запись для психологов, репетиторов и других специалистов частной практики: расписание, пакеты занятий с предоплатой, кабинет клиента и своя страница. Без таблиц и переписки в мессенджерах — и бесплатно."}
          </p>

          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a
              href={links.signup}
              data-goal={signupGoal("free")}
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 rounded-full px-6 text-[15px]",
              )}
            >
              Начать бесплатно
            </a>
            {links.demo ? (
              <a href={links.demo} className={secondary}>
                Посмотреть пример
              </a>
            ) : (
              <a href="#pricing" className={secondary}>
                Сравнить тарифы
              </a>
            )}
          </div>
          <p className="text-muted-foreground mt-5 text-sm">
            Карта не нужна. Принимать оплату онлайн можно в «{paidPlan.name}»:{" "}
            <a
              href="#pricing"
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              первые {paidPlan.trialDays} дней бесплатно
            </a>
          </p>
        </div>

        <figure className="flex flex-col gap-3">
          <BookingDemo demo={page?.demo} />
          <figcaption className="text-muted-foreground text-center text-sm">
            Так вашу страницу видит клиент. Выберите день и время.
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}

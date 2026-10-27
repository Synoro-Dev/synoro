import { buttonVariants, cn } from "@synoro/ui";
import { ArrowRightIcon, PlayIcon } from "lucide-react";

import { BookingPageMockup } from "~/components/mockups/booking-page";
import { paidPlan, rubles, signupGoal } from "~/lib/pricing";
import type { SiteLinks } from "~/lib/site";

import { Container } from "./primitives";

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black_30%,transparent_75%)]" />
      <div className="absolute top-[38rem] left-1/2 h-[28rem] w-[min(1100px,100%)] -translate-x-1/2 rounded-full bg-[conic-gradient(from_200deg_at_50%_50%,#c4b5fd,#a5f3fc,#bbf7d0,#fde68a,#fbcfe8,#c4b5fd)] opacity-40 blur-[110px]" />
    </div>
  );
}

export function Hero({ links }: { links: SiteLinks }) {
  return (
    <section id="top" className="relative isolate overflow-hidden pt-16">
      <Backdrop />
      <Container className="px-4 pt-20 pb-24 sm:px-10 sm:pt-28 sm:pb-32">
        <div className="animate-fade-up flex flex-col items-center text-center">
          <a
            href="#pricing"
            className="bg-background/70 hover:bg-background group mb-8 inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm shadow-xs backdrop-blur transition-colors"
          >
            <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white">
              0 ₽
            </span>
            Бесплатно навсегда, без лимита записей
            <ArrowRightIcon className="text-muted-foreground size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </a>

          <h1 className="max-w-4xl text-[2.6rem] leading-[1.05] font-medium tracking-tighter text-balance sm:text-6xl md:text-7xl">
            Клиенты записываются сами.{" "}
            <span className="bg-linear-to-b from-zinc-500 to-zinc-400 bg-clip-text text-transparent">
              Вы — работаете с людьми.
            </span>
          </h1>

          <p className="text-muted-foreground mt-6 max-w-2xl text-lg text-pretty sm:text-xl">
            Онлайн-запись для частной практики: расписание, пакеты с
            предоплатой, кабинет клиента и своя страница — без таблиц и
            переписки в мессенджерах. И всё это — бесплатно.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a
              href={links.signup}
              data-goal={signupGoal("free")}
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 rounded-full px-6 text-[15px]",
              )}
            >
              Начать бесплатно
              <ArrowRightIcon data-icon="inline-end" />
            </a>
            {links.demo ? (
              <a
                href={links.demo}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 rounded-full px-6 text-[15px]",
                )}
              >
                <PlayIcon data-icon="inline-start" className="size-3.5" />
                Открыть демо-страницу
              </a>
            ) : (
              <a
                href="#pricing"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 rounded-full px-6 text-[15px]",
                )}
              >
                Сравнить тарифы
              </a>
            )}
          </div>
          <p className="text-muted-foreground mt-5 text-sm">
            Без карты · Онлайн-оплата через{" "}
            <a
              href="#pricing"
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              ЮKassa — {rubles(paidPlan.monthly)}/мес
            </a>
          </p>
        </div>

        <div className="animate-fade-up mx-auto mt-20 max-w-5xl [animation-delay:150ms]">
          <BookingPageMockup />
        </div>
      </Container>
    </section>
  );
}

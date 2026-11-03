import { legal } from "@synoro/config";
import { buttonVariants, cn } from "@synoro/ui";
import { MailIcon } from "lucide-react";

import { brand } from "~/lib/brand";
import { paidPlan, signupGoal } from "~/lib/pricing";
import type { SiteLinks } from "~/lib/site";

import { Logo } from "./logo";
import { Section, SectionHeading } from "./primitives";

async function CurrentYear() {
  "use cache";
  return new Date().getFullYear();
}

export function FinalCta({ links }: { links: SiteLinks }) {
  return (
    <Section containerClassName="px-4 py-16 sm:px-10 sm:py-24">
      <div className="relative isolate overflow-hidden rounded-3xl bg-zinc-950 px-6 py-16 text-center text-white sm:px-16 sm:py-24">
        <div
          aria-hidden
          className="bg-grid absolute inset-0 -z-10 [--grid-color:rgb(255_255_255/0.06)] [--grid-size:32px] [mask-image:radial-gradient(ellipse_50%_70%_at_50%_100%,black,transparent)]"
        />
        <SectionHeading className="mx-auto max-w-2xl">
          Начните принимать записи сегодня — бесплатно
        </SectionHeading>
        <p className="mx-auto mt-5 max-w-lg text-zinc-400 sm:text-lg">
          Настройка займёт несколько минут — и больше никаких «а есть окошко в
          четверг?». А когда клиенты захотят платить онлайн, включите
          онлайн-оплату в «{paidPlan.name}»: первые {paidPlan.trialDays} дней
          после создания практики бесплатно.
        </p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href={links.signup}
            data-goal={signupGoal("free")}
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-11 rounded-full bg-white px-6 text-[15px] text-zinc-950 hover:bg-zinc-200",
            )}
          >
            Начать бесплатно
          </a>
          {links.demo && (
            <a
              href={links.demo}
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                "h-11 rounded-full px-6 text-[15px] text-white ring-1 ring-white/15 hover:bg-white/10 hover:text-white",
              )}
            >
              Посмотреть пример
            </a>
          )}
        </div>
        <p className="mt-8 text-sm text-zinc-400">
          Есть вопросы? Напишите нам:{" "}
          <a
            href={`mailto:${legal.operator.email}`}
            className="font-medium text-white underline underline-offset-4 transition-colors hover:text-zinc-300"
          >
            {legal.operator.email}
          </a>
        </p>
      </div>
    </Section>
  );
}

export async function Footer({ links }: { links: SiteLinks }) {
  const columns = [
    {
      title: "Продукт",
      items: [
        { href: "/#features", label: "Возможности" },
        { href: "/#domain", label: "Свой адрес" },
        { href: "/#pricing", label: "Тарифы" },
        { href: "/#faq", label: "Вопросы" },
      ],
    },
    {
      title: "Аккаунт",
      items: [
        { href: links.login, label: "Войти" },
        { href: links.signup, label: "Регистрация" },
        ...(links.demo
          ? [{ href: links.demo, label: "Посмотреть пример" }]
          : []),
      ],
    },
    {
      title: "Документы",
      items: Object.values(legal.docs).map((doc) => ({
        href: doc.path,
        label: doc.short,
      })),
    },
  ];

  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:border-x sm:px-10 md:grid-cols-[2fr_1fr_1fr_1.4fr]">
        <div className="flex flex-col gap-4">
          <Logo />
          <p className="text-muted-foreground max-w-xs text-sm">
            Онлайн-запись, расписание и пакеты с предоплатой для частной
            практики.
          </p>
          <a
            href={`mailto:${legal.operator.email}`}
            className="flex w-fit items-center gap-2 text-base font-medium transition-opacity hover:opacity-70"
          >
            <MailIcon className="size-4" aria-hidden />
            {legal.operator.email}
          </a>
        </div>
        {columns.map((column) => (
          <div key={column.title} className="flex flex-col gap-3 text-sm">
            <p className="font-medium">{column.title}</p>
            {column.items.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-muted-foreground hover:text-foreground w-fit transition-colors"
              >
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col justify-between gap-2 px-4 py-6 text-sm sm:flex-row sm:border-x sm:px-10">
          <p>
            © {await CurrentYear()} {brand.name}. Все права защищены.
          </p>
          <p>
            {legal.operator.name}, ИНН {legal.operator.inn}
            {legal.operator.ogrnip && `, ОГРНИП ${legal.operator.ogrnip}`}
          </p>
        </div>
      </div>
    </footer>
  );
}

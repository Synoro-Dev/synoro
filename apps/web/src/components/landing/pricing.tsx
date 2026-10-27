"use client";

import { buttonVariants, cn } from "@synoro/ui";
import { CheckIcon, CreditCardIcon } from "lucide-react";
import { useState } from "react";

import { Eyebrow, Lead, SectionHeading } from "./primitives";

type Plan = {
  name: string;
  description: string;
  /** Rubles per month; `null` — free. */
  monthly: number | null;
  yearly: number | null;
  features: string[];
  cta: string;
  featured?: boolean;
};

// Placeholder prices: replace with the real ones before launch.
const plans: Plan[] = [
  {
    name: "Старт",
    description: "Чтобы попробовать и принять первых клиентов.",
    monthly: null,
    yearly: null,
    features: [
      "Страница записи на платформе",
      "Расписание и закрытое время",
      "Бесплатные знакомства на 30 минут",
      "Кабинет клиента",
    ],
    cta: "Начать бесплатно",
  },
  {
    name: "Практика",
    description: "Для специалиста с постоянными клиентами.",
    monthly: 990,
    yearly: 790,
    features: [
      "Всё из «Старта»",
      "Пакеты консультаций и журнал баланса",
      "Свой домен для страницы записи",
      "Администратор в команде",
      "Неограниченные записи",
    ],
    cta: "Попробовать 14 дней",
    featured: true,
  },
  {
    name: "Студия",
    description: "Для центров и нескольких специалистов.",
    monthly: 2490,
    yearly: 1990,
    features: [
      "Всё из «Практики»",
      "Несколько практик в одном аккаунте",
      "До 5 администраторов",
      "Помощь с переносом клиентов",
    ],
    cta: "Попробовать 14 дней",
  },
];

const rubles = new Intl.NumberFormat("ru-RU");

export function Pricing({ signupUrl }: { signupUrl: string }) {
  const [yearly, setYearly] = useState(true);

  return (
    <>
      <div className="flex flex-col items-center gap-5 px-4 pt-16 pb-12 text-center sm:px-10 sm:pt-24">
        <Eyebrow icon={CreditCardIcon} tone="sky">
          Тарифы
        </Eyebrow>
        <SectionHeading>Растёт вместе с практикой</SectionHeading>
        <Lead className="mx-auto">
          Начните бесплатно и переходите на платный тариф, когда понадобятся
          пакеты и свой домен.
        </Lead>
        <fieldset className="bg-muted mt-2 inline-flex rounded-full border p-1 text-sm">
          <legend className="sr-only">Период оплаты</legend>
          {[
            { value: false, label: "Помесячно" },
            { value: true, label: "За год" },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={yearly === option.value}
              onClick={() => setYearly(option.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors",
                yearly === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
              {option.value && (
                <span className="rounded-full bg-emerald-500/10 px-1.5 text-xs font-medium text-emerald-700">
                  −20%
                </span>
              )}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="grid border-t md:grid-cols-3 md:divide-x">
        {plans.map((plan) => {
          const price = yearly ? plan.yearly : plan.monthly;
          return (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col gap-6 border-b p-6 last:border-b-0 sm:p-8 md:border-b-0",
                plan.featured && "bg-muted/60",
              )}
            >
              {plan.featured && (
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-500 to-transparent"
                />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-medium">{plan.name}</p>
                  {plan.featured && (
                    <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-500/20 ring-inset">
                      Популярный
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 min-h-10 text-sm">
                  {plan.description}
                </p>
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="text-4xl font-medium tracking-tight tabular-nums">
                  {price === null ? "0 ₽" : `${rubles.format(price)} ₽`}
                </span>
                <span className="text-muted-foreground text-sm">
                  {price === null ? "навсегда" : "в месяц"}
                </span>
              </p>
              <a
                href={signupUrl}
                className={cn(
                  buttonVariants({
                    variant: plan.featured ? "default" : "outline",
                    size: "lg",
                  }),
                  "rounded-full",
                )}
              >
                {plan.cta}
              </a>
              <ul className="flex flex-col gap-3 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}

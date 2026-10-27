"use client";

import { buttonVariants, cn } from "@synoro/ui";
import {
  CalendarCheckIcon,
  CheckIcon,
  CoinsIcon,
  CreditCardIcon,
  GiftIcon,
} from "lucide-react";
import { useState } from "react";

import {
  featuredPlan,
  maxYearlyPercent,
  type Period,
  type Plan,
  perDay,
  perMonth,
  planSignupUrl,
  plans,
  rubles,
  signupGoal,
  trialDays,
  yearlySavings,
} from "~/lib/pricing";

import {
  Eyebrow,
  IconTile,
  Lead,
  SectionHeading,
  type Tone,
} from "./primitives";

const perks: {
  icon: typeof CoinsIcon;
  tone: Tone;
  title: string;
  text: string;
}[] = [
  {
    icon: CoinsIcon,
    tone: "emerald",
    title: `≈${perDay(featuredPlan.yearly)} ₽ в день`,
    text: `Столько стоит «${featuredPlan.name}» при оплате за год.`,
  },
  {
    icon: CalendarCheckIcon,
    tone: "violet",
    title: "Цена не вырастет",
    text: "Оплатили год — цена зафиксирована до конца срока.",
  },
  {
    icon: GiftIcon,
    tone: "amber",
    title: `${trialDays} дней бесплатно`,
    text: "Попробуйте любой платный тариф без привязки карты, а потом решайте.",
  },
];

function Price({ plan, period }: { plan: Plan; period: Period }) {
  if (plan.monthly === null || plan.yearly === null) {
    return (
      <div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-medium tracking-tight">0 ₽</span>
          <span className="text-muted-foreground text-sm">навсегда</span>
        </p>
        <p className="text-muted-foreground mt-1.5 min-h-10 text-sm">
          Без ограничений по времени
        </p>
      </div>
    );
  }

  const savings = yearlySavings(plan);
  if (period === "month") {
    return (
      <div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-medium tracking-tight tabular-nums">
            {rubles(plan.monthly)}
          </span>
          <span className="text-muted-foreground text-sm">в месяц</span>
        </p>
        <p className="text-muted-foreground mt-1.5 min-h-10 text-sm">
          Или {rubles(plan.yearly)} за год — выгоднее на {savings?.percent}%
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-4xl font-medium tracking-tight tabular-nums">
          {rubles(plan.yearly)}
        </span>
        <span className="text-muted-foreground text-sm">за год</span>
      </p>
      {/* Two fixed lines, so CTAs line up across cards. */}
      <div className="text-muted-foreground mt-1.5 min-h-10 text-sm">
        <p>{rubles(perMonth(plan.yearly))} в месяц</p>
        {savings && (
          <p className="flex gap-2">
            <s className="tabular-nums">{rubles(savings.full)}</s>
            <span className="font-medium text-emerald-700">
              выгода {rubles(savings.amount)}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

export function Pricing({ signupUrl }: { signupUrl: string }) {
  const [period, setPeriod] = useState<Period>("year");

  return (
    <>
      <div className="flex flex-col items-center gap-5 px-4 pt-16 pb-12 text-center sm:px-10 sm:pt-24">
        <Eyebrow icon={CreditCardIcon} tone="sky">
          Тарифы
        </Eyebrow>
        <SectionHeading>
          Год онлайн-записи — по цене одной консультации
        </SectionHeading>
        <Lead className="mx-auto">
          «{featuredPlan.name}» за {rubles(featuredPlan.yearly)} в год — это{" "}
          {rubles(perMonth(featuredPlan.yearly))} в месяц. Одна запись, которую
          не пришлось согласовывать в переписке, уже окупает тариф.
        </Lead>
        <fieldset className="bg-muted mt-2 inline-flex rounded-full border p-1 text-sm">
          <legend className="sr-only">Период оплаты</legend>
          {(
            [
              { value: "month", label: "Помесячно" },
              { value: "year", label: "За год" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={period === option.value}
              onClick={() => setPeriod(option.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors",
                period === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
              {option.value === "year" && (
                <span className="rounded-full bg-emerald-500/10 px-1.5 text-xs font-medium text-emerald-700">
                  до −{maxYearlyPercent}%
                </span>
              )}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="grid border-t md:grid-cols-3 md:divide-x">
        {plans.map((plan) => {
          const free = plan.monthly === null;
          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col gap-6 border-b p-6 sm:p-8 md:border-b-0",
                // On a phone the offer goes first, ahead of the free plan.
                plan.featured && "bg-muted/60 max-md:order-first",
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
                      Выбирают чаще всего
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 min-h-10 text-sm">
                  {plan.description}
                </p>
              </div>
              <Price plan={plan} period={period} />
              <div className="flex flex-col gap-2">
                <a
                  href={planSignupUrl(signupUrl, plan.id, period)}
                  data-goal={signupGoal(plan.id, period)}
                  className={cn(
                    buttonVariants({
                      variant: plan.featured ? "default" : "outline",
                      size: "lg",
                    }),
                    "rounded-full",
                  )}
                >
                  {free
                    ? "Начать бесплатно"
                    : period === "year"
                      ? "Подключить на год"
                      : "Подключить помесячно"}
                </a>
                <p className="text-muted-foreground text-center text-xs">
                  {free
                    ? "Без карты и пробных периодов"
                    : `Первые ${trialDays} дней — бесплатно`}
                </p>
              </div>
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

      <ul className="grid border-t sm:grid-cols-3 sm:divide-x">
        {perks.map((perk) => (
          <li
            key={perk.title}
            className="flex gap-3 border-b p-6 last:border-b-0 sm:border-b-0 sm:p-8"
          >
            <IconTile icon={perk.icon} tone={perk.tone} className="shrink-0" />
            <div>
              <p className="font-medium">{perk.title}</p>
              <p className="text-muted-foreground mt-1 text-sm">{perk.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

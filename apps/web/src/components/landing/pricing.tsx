import { legal } from "@synoro/config";
import { buttonVariants, cn } from "@synoro/ui";
import {
  BadgePercentIcon,
  CheckIcon,
  CreditCardIcon,
  GiftIcon,
  InfinityIcon,
} from "lucide-react";

import {
  billingStart,
  enterpriseContactUrl,
  enterpriseGoal,
  type Plan,
  paidPlan,
  planSignupUrl,
  plans,
  rubles,
  signupGoal,
} from "~/lib/pricing";

import {
  Eyebrow,
  IconTile,
  Lead,
  SectionHeading,
  type Tone,
} from "./primitives";

const perks: {
  icon: typeof InfinityIcon;
  tone: Tone;
  title: string;
  text: string;
}[] = [
  {
    icon: InfinityIcon,
    tone: "emerald",
    title: "Бесплатно навсегда",
    text: "Без лимитов на записи и клиентов и без пробного срока.",
  },
  {
    icon: BadgePercentIcon,
    tone: "violet",
    title: "Без процента с оплат",
    text: "Деньги клиентов идут сразу на ваш счёт в ЮKassa — мы ничего не удерживаем.",
  },
  {
    icon: GiftIcon,
    tone: "amber",
    title: `«${paidPlan.name}» бесплатно до ${billingStart.label}`,
    text: "Подключите онлайн-оплату без привязки карты — платить начнёте только с нового года.",
  },
];

function Price({ plan }: { plan: Plan }) {
  if (plan.custom) {
    return (
      <div>
        <p className="text-4xl font-medium tracking-tight">По договорённости</p>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Стоимость зависит от задач и объёма доработок
        </p>
      </div>
    );
  }

  if (plan.monthly === null) {
    return (
      <div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-medium tracking-tight">0 ₽</span>
          <span className="text-muted-foreground text-sm">навсегда</span>
        </p>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Без карты и ограничений по времени
        </p>
      </div>
    );
  }

  const free = plan.freeUntilBilling;

  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-4xl font-medium tracking-tight tabular-nums">
          {rubles(free ? 0 : plan.monthly)}
        </span>
        {free && (
          <span className="text-muted-foreground text-lg tabular-nums line-through">
            {rubles(plan.monthly)}
          </span>
        )}
        <span className="text-muted-foreground text-sm">в месяц</span>
      </p>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {free
          ? `Бесплатно до ${billingStart.label}, затем ${rubles(plan.monthly)} в месяц`
          : "Оплата помесячно"}
      </p>
    </div>
  );
}

function PlanCta({ plan, signupUrl }: { plan: Plan; signupUrl: string }) {
  const className = cn(
    buttonVariants({
      variant: plan.featured ? "default" : "outline",
      size: "lg",
    }),
    "rounded-full",
  );

  if (plan.id === "enterprise") {
    return (
      <a
        href={enterpriseContactUrl(legal.operator.email)}
        data-goal={enterpriseGoal}
        className={className}
      >
        Обсудить задачу
      </a>
    );
  }

  return (
    <a
      href={planSignupUrl(signupUrl, plan.id)}
      data-goal={signupGoal(plan.id)}
      className={className}
    >
      {plan.id === "free" ? "Начать бесплатно" : "Подключить бесплатно"}
    </a>
  );
}

export function Pricing({ signupUrl }: { signupUrl: string }) {
  return (
    <>
      <div className="flex flex-col items-center gap-5 px-4 pt-16 pb-12 text-center sm:px-10 sm:pt-24">
        <Eyebrow icon={CreditCardIcon} tone="sky">
          Тарифы
        </Eyebrow>
        <SectionHeading>
          Бесплатно для практики. «{paidPlan.name}» — тоже, до{" "}
          {billingStart.label}
        </SectionHeading>
        <Lead className="mx-auto">
          Запись, расписание, пакеты и кабинет клиента — бесплатно и без
          ограничений. «{paidPlan.name}» нужен, чтобы клиенты оплачивали пакеты
          сами через ЮKassa: до {billingStart.label} он бесплатный, затем{" "}
          {rubles(paidPlan.monthly)} в месяц.
        </Lead>
      </div>

      <div className="grid border-t md:grid-cols-3 md:divide-x">
        {plans.map((plan) => {
          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col gap-6 border-b p-6 sm:p-8 md:border-b-0",
                plan.featured && "bg-muted/60",
              )}
            >
              {plan.featured && (
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-emerald-500 to-transparent"
                />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-medium">{plan.name}</p>
                  {plan.featured && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/20 ring-inset">
                      Хватит большинству
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 min-h-10 text-sm">
                  {plan.description}
                </p>
              </div>
              <Price plan={plan} />
              <PlanCta plan={plan} signupUrl={signupUrl} />
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

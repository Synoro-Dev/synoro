/**
 * Plans and prices shown on the landing — the single place to change them.
 * Client-safe (no env access): the pricing table is a client component.
 */

export type PlanId = "start" | "practice" | "studio";
export type Period = "month" | "year";

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  /** Rubles for one month; `null` — free. */
  monthly: number | null;
  /** Rubles for the whole year, paid upfront; `null` — free. */
  yearly: number | null;
  features: string[];
  featured?: boolean;
};

export const plans: Plan[] = [
  {
    id: "start",
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
  },
  {
    id: "practice",
    name: "Практика",
    description: "Для специалиста с постоянными клиентами.",
    monthly: 490,
    yearly: 2990,
    features: [
      "Всё из «Старта»",
      "Неограниченные записи",
      "Пакеты консультаций и журнал баланса",
      "Свой домен для страницы записи",
      "Администратор в команде",
    ],
    featured: true,
  },
  {
    id: "studio",
    name: "Студия",
    description: "Для центров и нескольких специалистов.",
    monthly: 1490,
    yearly: 8990,
    features: [
      "Всё из «Практики»",
      "Несколько практик в одном аккаунте",
      "До 5 администраторов",
      "Помощь с переносом клиентов",
    ],
  },
];

/** Free trial of any paid plan, in days. */
export const trialDays = 14;

function getPlan(id: PlanId) {
  const plan = plans.find((item) => item.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** The plan the landing sells: ads, hero and the sticky CTA point here. */
export const featuredPlan = getPlan("practice") as Plan & {
  monthly: number;
  yearly: number;
};

export const rubles = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

/** Yearly price spread over 12 months, rounded down like price tags are. */
export const perMonth = (yearly: number) => Math.floor(yearly / 12);

/** Yearly price spread over 365 days. */
export const perDay = (yearly: number) => Math.round(yearly / 365);

/** What paying for a year saves against 12 monthly payments. */
export function yearlySavings(plan: Plan) {
  if (plan.monthly === null || plan.yearly === null) return null;
  const full = plan.monthly * 12;
  return {
    full,
    amount: full - plan.yearly,
    percent: Math.round((1 - plan.yearly / full) * 100),
  };
}

/** Biggest yearly discount across plans, for the period switch badge. */
export const maxYearlyPercent = Math.max(
  ...plans.map((plan) => yearlySavings(plan)?.percent ?? 0),
);

/**
 * Sign-up link that remembers the chosen plan, so the app can preselect it
 * once billing lands. The free plan needs no parameters.
 */
export function planSignupUrl(signupUrl: string, id: PlanId, period: Period) {
  if (id === "start") return signupUrl;
  const url = new URL(signupUrl);
  url.searchParams.set("plan", id);
  url.searchParams.set("period", period);
  return url.toString();
}

/** Yandex Metrika goal names fired by sign-up CTAs (`data-goal`). */
export const signupGoal = (id: PlanId, period: Period) =>
  id === "start" ? "signup_free" : `signup_${id}_${period}`;

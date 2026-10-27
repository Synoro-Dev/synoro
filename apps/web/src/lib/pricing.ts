/**
 * Plans and prices shown on the landing — the single place to change them.
 * Client-safe (no env access): the pricing table is a client component.
 *
 * Freemium: a solo practice runs on the free plan for good; people pay once
 * they take money online (ЮKassa) or grow into a team. See
 * docs/pricing-strategy.md.
 */

export type PlanId = "free" | "pro" | "studio";

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  /** Rubles a month; `null` — free. */
  monthly: number | null;
  features: string[];
  featured?: boolean;
};

export const plans: Plan[] = [
  {
    id: "free",
    name: "Бесплатный",
    description: "Всё, чтобы вести практику и принимать клиентов.",
    monthly: null,
    features: [
      "Неограниченные записи и клиенты",
      "Страница записи и расписание",
      "Бесплатные знакомства для новых клиентов",
      "Пакеты консультаций и журнал баланса",
      "Кабинет клиента и отмена без звонков",
    ],
    featured: true,
  },
  {
    id: "pro",
    name: "Про",
    description: "Когда клиенты готовы платить онлайн.",
    monthly: 290,
    features: [
      "Всё из бесплатного",
      "Оплата пакетов онлайн через ЮKassa",
      "Консультации начисляются сразу после оплаты",
      "Свой домен для страницы записи",
      "Администратор в команде",
    ],
  },
  {
    id: "studio",
    name: "Студия",
    description: "Для центров и нескольких специалистов.",
    monthly: 790,
    features: [
      "Всё из «Про»",
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

/** The plan for online payments: the upsell the landing mentions. */
export const paidPlan = getPlan("pro") as Plan & { monthly: number };

export const rubles = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

/**
 * Sign-up link that remembers the chosen plan, so the app can preselect it
 * once billing lands. The free plan needs no parameters.
 */
export function planSignupUrl(signupUrl: string, id: PlanId) {
  if (id === "free") return signupUrl;
  const url = new URL(signupUrl);
  url.searchParams.set("plan", id);
  return url.toString();
}

/** Yandex Metrika goal names fired by sign-up CTAs (`data-goal`). */
export const signupGoal = (id: PlanId) => `signup_${id}`;

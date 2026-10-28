/**
 * Plans and prices shown on the landing — the single place to change them.
 * Client-safe (no env access): the pricing table is a client component.
 *
 * Freemium: a solo practice runs on the free plan for good; people pay once
 * they take money online (ЮKassa). «Про» starts with a free trial, then
 * 149 ₽ a month or 1490 ₽ a year, paid in the app through Точка Банк. Large
 * teams talk to us: Enterprise is priced per agreement and includes custom
 * development. See docs/pricing-strategy.md. The app charges
 * `PRO_PRICES` (@synoro/validators): keep both in sync.
 */

export type PlanId = "free" | "pro" | "enterprise";

/** Plans a visitor can sign up for on their own. */
export type SignupPlanId = Exclude<PlanId, "enterprise">;

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  /**
   * Rubles a month once the plan is paid; `null` — free, or by agreement
   * when `custom`.
   */
  monthly: number | null;
  /** Rubles for a year paid up front, when offered. */
  yearly?: number;
  /** Free days before the first payment. */
  trialDays?: number;
  /** Priced by agreement, not self-serve: the CTA is "contact us". */
  custom?: boolean;
  features: string[];
  featured?: boolean;
};

/**
 * Specialists who signed up while «Про» was free keep it free until this
 * day (their trial end, set by the billing migration); the Terms promise it.
 */
export const earlyAccessUntil = { iso: "2027-01-01", label: "1 января 2027" };

export const plans: Plan[] = [
  {
    id: "free",
    name: "Бесплатный",
    description: "Всё, чтобы вести практику и принимать клиентов.",
    monthly: null,
    features: [
      "Неограниченные записи и клиенты",
      "Страница записи и расписание",
      "Бесплатная первая встреча для новых клиентов",
      "Пакеты с предоплатой и журнал баланса",
      "Кабинет клиента и отмена без звонков",
    ],
    featured: true,
  },
  {
    id: "pro",
    name: "Про",
    description: "Когда клиенты готовы платить онлайн.",
    monthly: 149,
    yearly: 1490,
    trialDays: 14,
    features: [
      "Всё из бесплатного",
      "Оплата пакетов онлайн через ЮKassa",
      "Пакет начисляется сразу после оплаты",
      "Свой домен для страницы записи",
      "Администратор в команде",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Для центров и команд: подстроим Synoro под ваши процессы.",
    monthly: null,
    custom: true,
    features: [
      "Всё из «Про»",
      "Несколько практик в одном аккаунте",
      "Любое число администраторов",
      "Доработки под ваши процессы и интеграции",
      "Приоритетная поддержка и помощь с переносом",
    ],
  },
];

function getPlan(id: PlanId) {
  const plan = plans.find((item) => item.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** The plan for online payments: the upsell the landing mentions. */
export const paidPlan = getPlan("pro") as Plan & {
  monthly: number;
  yearly: number;
  trialDays: number;
};

export const rubles = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

/**
 * Sign-up link that remembers the chosen plan (`?plan=pro`). The free plan needs no parameters.
 */
export function planSignupUrl(signupUrl: string, id: SignupPlanId) {
  if (id === "free") return signupUrl;
  const url = new URL(signupUrl);
  url.searchParams.set("plan", id);
  return url.toString();
}

/** Yandex Metrika goal names fired by sign-up CTAs (`data-goal`). */
export const signupGoal = (id: SignupPlanId) => `signup_${id}`;

/** Goal for the Enterprise "contact us" CTA. */
export const enterpriseGoal = "contact_enterprise";

/** `mailto:` link for an Enterprise enquiry. */
export function enterpriseContactUrl(email: string) {
  const subject = encodeURIComponent("Synoro Enterprise");
  return `mailto:${email}?subject=${subject}`;
}

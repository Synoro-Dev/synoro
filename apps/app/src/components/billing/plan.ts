import type { RouterOutputs } from "@synoro/api";

export type Plan = RouterOutputs["billing"]["get"]["plan"];

const DAY = 24 * 60 * 60 * 1000;

/** «Про» warns this many days before the trial or paid period ends. */
export const ENDING_SOON_DAYS = 3;

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
export const formatDate = (at: Date) => dateFormat.format(at);

const dayWords = new Intl.PluralRules("ru-RU");
const DAY_FORMS: Record<string, string> = {
  one: "день",
  few: "дня",
  many: "дней",
  other: "дня",
};
/** 1 день, 3 дня, 9 дней. */
export const formatDays = (days: number) =>
  `${days} ${DAY_FORMS[dayWords.select(days)]}`;

/** Whole days left before `until`, counting today. */
export function daysLeft(until: Date, now = new Date()) {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY));
}

/** What the user is on right now, in their words. */
export function planName(plan: Plan) {
  if (plan.status === "trial") return "Пробный «Про»";
  if (plan.status === "active") return "«Про»";
  return "Бесплатный";
}

/** The free plan, for good: what keeps working without «Про». */
export const FREE_FEATURES = [
  "Неограниченные записи и клиенты",
  "Страница записи и расписание",
  "Бесплатная первая встреча для новых клиентов",
  "Пакеты с предоплатой и журнал баланса",
  "Кабинет клиента и отмена без звонков",
];

/** What «Про» adds on top of the free plan. */
export const PRO_FEATURES = [
  "Оплата пакетов онлайн через ЮKassa или Т-Банк",
  "Пакет начисляется клиенту сразу после оплаты",
  "Своё оформление страницы записи",
  "Администратор в команде",
  "Анкета для клиента перед записью",
  "Свои сообщения клиентам",
  "Напоминания и уведомления в Telegram и MAX",
  "Аналитика практики",
];

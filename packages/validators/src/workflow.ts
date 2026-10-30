import { z } from "zod";

/**
 * Own messages to clients on «Про» («Workflows» in cal.com).
 *
 * after_end   — some hours after a meeting ended;
 * low_balance — after a booking left the client with few meetings;
 * inactive    — a client has not booked for a number of days.
 *
 * Keep in sync with the `workflow_trigger` enum in `@synoro/db`.
 */
export const WORKFLOW_TRIGGERS = [
  "after_end",
  "low_balance",
  "inactive",
] as const;

export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

/** How many rules one practice can have. */
export const MAX_WORKFLOWS = 10;

/**
 * Placeholders a text may use: `{имя}`. The values are filled in per client
 * and per booking, see `renderWorkflowText`.
 */
export const WORKFLOW_VARIABLES = {
  имя: "имя клиента",
  практика: "название практики",
  дата: "дата последней встречи («3 ноября»)",
  время: "время последней встречи («19:00»)",
  баланс: "сколько занятий осталось",
  ссылка: "страница записи",
  кабинет: "личный кабинет клиента",
} as const;

export type WorkflowVariable = keyof typeof WORKFLOW_VARIABLES;

/**
 * `amount` means a different thing for each trigger; the range is also a
 * CHECK constraint on `workflows` (keep both in sync).
 */
export const WORKFLOW_PRESETS: Record<
  WorkflowTrigger,
  {
    title: string;
    description: string;
    /** What `amount` counts, for the form label. */
    amountLabel: string;
    amountUnit: string;
    min: number;
    max: number;
    defaultAmount: number;
    subject: string;
    text: string;
  }
> = {
  after_end: {
    title: "После встречи",
    description:
      "Спасибо за встречу и ссылка на следующую запись. Уходит клиенту через несколько часов после конца встречи.",
    amountLabel: "Через сколько часов",
    amountUnit: "ч после встречи",
    min: 1,
    max: 72,
    defaultAmount: 2,
    subject: "Спасибо за встречу — {практика}",
    text: "Здравствуйте, {имя}!\n\nСпасибо, что были на встрече {дата}. Следующее время можно выбрать здесь: {ссылка}",
  },
  low_balance: {
    title: "Заканчивается пакет",
    description:
      "Напоминание пополнить пакет со ссылкой на оплату. Уходит, когда запись оставила клиенту мало занятий.",
    amountLabel: "Сколько занятий осталось",
    amountUnit: "занятий или меньше",
    min: 0,
    max: 5,
    defaultAmount: 1,
    subject: "В пакете осталось занятий: {баланс} — {практика}",
    text: "Здравствуйте, {имя}!\n\nВ вашем пакете осталось занятий: {баланс}. Чтобы время осталось за вами, пополните пакет: {ссылка}",
  },
  inactive: {
    title: "Давно не записывались",
    description:
      "Мягкое возвращение клиента, который не записывался несколько недель. Письмо уходит один раз после последней встречи.",
    amountLabel: "Сколько дней без записи",
    amountUnit: "дней без записи",
    min: 7,
    max: 180,
    defaultAmount: 30,
    subject: "Давно не виделись — {практика}",
    text: "Здравствуйте, {имя}!\n\nВы давно не записывались, последняя встреча была {дата}. Если хотите продолжить, выберите время: {ссылка}",
  },
};

const VARIABLE = /\{([^{}\n]*)\}/g;

/** Names between braces that `text` uses but nobody fills in. */
export function unknownWorkflowVariables(text: string) {
  const unknown = new Set<string>();
  for (const [, name = ""] of text.matchAll(VARIABLE)) {
    if (!Object.hasOwn(WORKFLOW_VARIABLES, name)) unknown.add(name);
  }
  return [...unknown];
}

/** Put `values` in place of `{имя}`-style placeholders; unknown ones stay. */
export function renderWorkflowText(
  text: string,
  values: Record<WorkflowVariable, string>,
) {
  return text.replace(VARIABLE, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name as WorkflowVariable] : whole,
  );
}

const placeholders =
  (field: string) => (text: string, ctx: z.RefinementCtx) => {
    const unknown = unknownWorkflowVariables(text);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${field}: нет переменной ${unknown.map((n) => `{${n}}`).join(", ")}`,
      });
    }
  };

/** The editor's form; `practiceId` / `id` are added by the procedures. */
export const workflowFormSchema = z
  .object({
    trigger: z.enum(WORKFLOW_TRIGGERS),
    amount: z.number().int(),
    subject: z
      .string()
      .trim()
      .min(1, "Укажите тему письма")
      .max(120, "Тема слишком длинная")
      .regex(/^[^\r\n]*$/, "Тема — одна строка")
      .superRefine(placeholders("Тема")),
    text: z
      .string()
      .trim()
      .min(1, "Напишите текст письма")
      .max(1000, "Не больше 1000 символов")
      .superRefine(placeholders("Текст")),
    active: z.boolean(),
  })
  .superRefine((rule, ctx) => {
    const { min, max, amountLabel } = WORKFLOW_PRESETS[rule.trigger];
    if (rule.amount < min || rule.amount > max) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: `${amountLabel}: от ${min} до ${max}`,
      });
    }
  });

export type WorkflowForm = z.infer<typeof workflowFormSchema>;

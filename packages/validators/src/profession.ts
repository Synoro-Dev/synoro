/**
 * What a practice does, and the words its pages use for it. The code speaks
 * of credits and free slots; a psychologist's clients see «консультации», a
 * tutor's — «занятия». See GLOSSARY.md and docs/beyond-psychologists.md.
 */

export const PROFESSIONS = [
  "psychologist",
  "coach",
  "tutor",
  "trainer",
  "health",
  "legal",
  "other",
] as const;

export type Profession = (typeof PROFESSIONS)[number];

/** Russian noun forms after a number: 1 консультация, 3 консультации, 5 консультаций. */
export type CountForms = readonly [one: string, few: string, many: string];

export interface ProfessionTerms {
  /** In the profile picker. */
  label: string;
  /**
   * The credit — one paid booking — after a number. `many` doubles as the
   * genitive plural: «пакет консультаций», «нет оплаченных занятий».
   */
  credit: CountForms;
  /** Nominative / accusative plural: «оплатить консультации», «приёмы». */
  credits: string;
  /** Accusative singular: «запись на консультацию», «цена за тренировку». */
  creditAccusative: string;
  /** The free, staff-booked slot: «Знакомство», «Пробное занятие». */
  free: string;
}

export const PROFESSION_TERMS: Record<Profession, ProfessionTerms> = {
  psychologist: {
    label: "Психолог, психотерапевт",
    credit: ["консультация", "консультации", "консультаций"],
    credits: "консультации",
    creditAccusative: "консультацию",
    free: "Знакомство",
  },
  coach: {
    label: "Коуч",
    credit: ["сессия", "сессии", "сессий"],
    credits: "сессии",
    creditAccusative: "сессию",
    free: "Знакомство",
  },
  tutor: {
    label: "Репетитор, преподаватель",
    credit: ["занятие", "занятия", "занятий"],
    credits: "занятия",
    creditAccusative: "занятие",
    free: "Пробное занятие",
  },
  trainer: {
    label: "Тренер",
    credit: ["тренировка", "тренировки", "тренировок"],
    credits: "тренировки",
    creditAccusative: "тренировку",
    free: "Пробная тренировка",
  },
  health: {
    label: "Врач, логопед, нутрициолог",
    credit: ["приём", "приёма", "приёмов"],
    credits: "приёмы",
    creditAccusative: "приём",
    free: "Первичная консультация",
  },
  legal: {
    label: "Юрист, финансовый консультант",
    credit: ["консультация", "консультации", "консультаций"],
    credits: "консультации",
    creditAccusative: "консультацию",
    free: "Первичная консультация",
  },
  other: {
    label: "Другое",
    credit: ["встреча", "встречи", "встреч"],
    credits: "встречи",
    creditAccusative: "встречу",
    free: "Бесплатная встреча",
  },
};

export function professionTerms(profession: Profession): ProfessionTerms {
  return PROFESSION_TERMS[profession];
}

/** The form of `forms` that goes after `count`. */
export function pluralize(count: number, forms: CountForms) {
  const n = Math.abs(count);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }
  return forms[2];
}

/** «1 консультация», «3 занятия», «5 приёмов». */
export function formatCredits(count: number, terms: ProfessionTerms) {
  return `${count} ${pluralize(count, terms.credit)}`;
}

/** «консультация» → «Консультация». */
export function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

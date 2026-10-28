/**
 * Who stands behind the service and where its legal documents live. The
 * documents themselves are pages of the landing (apps/web, `/legal/*`); the
 * product app links to them by absolute URL, so a sign-up form on
 * app.synoro.ru and a booking page on a practice's own domain point at the
 * same text.
 */

interface Operator {
  /** Short form for headings and the footer. */
  name: string;
  /** Full form for the documents. */
  fullName: string;
  inn: string;
  /** Fill in to show it on the legal pages (the field is omitted while unset). */
  ogrnip?: string;
  /** Fill in to show it on the legal pages (the field is omitted while unset). */
  address?: string;
  /** Contact for support, notices, requests of data subjects. */
  email: string;
}

export const legal = {
  operator: {
    name: "ИП Карпычев Максим Александрович",
    fullName: "Индивидуальный предприниматель Карпычев Максим Александрович",
    inn: "504408371838",
    ogrnip: "318500700048744",
    address:
      "141554, Московская обл., г. о. Солнечногорск, д. Кривцово, д. 14, кв. 35",
    email: "info@synoro.ru",
  } satisfies Operator as Operator,
  /** Canonical origin of the documents (the landing). */
  siteUrl: "https://synoro.ru",
  /** Date of the current edition of every document, ISO. */
  updatedAt: "2026-10-28",
  docs: {
    terms: {
      path: "/legal/terms",
      title: "Пользовательское соглашение и публичная оферта",
      short: "Пользовательское соглашение",
      description:
        "Условия использования Synoro специалистами: тарифы, оплата, права и ответственность.",
    },
    bookingTerms: {
      path: "/legal/booking-terms",
      title: "Условия для клиентов специалистов",
      short: "Условия для клиентов",
      description:
        "Как работает запись и оплата на странице специалиста, баланс, отмена, возврат.",
    },
    privacy: {
      path: "/legal/privacy",
      title: "Политика обработки персональных данных",
      short: "Политика конфиденциальности",
      description:
        "Какие данные мы собираем, зачем, как храним и как их удалить.",
    },
    consent: {
      path: "/legal/consent",
      title: "Согласие на обработку персональных данных",
      short: "Согласие на обработку данных",
      description:
        "Текст согласия, которое вы даёте при регистрации и записи к специалисту.",
    },
    cookies: {
      path: "/legal/cookies",
      title: "Политика использования cookie",
      short: "Cookie",
      description:
        "Какие cookie и счётчики использует сайт и как их отключить.",
    },
  },
} as const;

export type LegalDocKey = keyof typeof legal.docs;

/** Absolute address of a legal document. */
export const legalUrl = (key: LegalDocKey) =>
  `${legal.siteUrl}${legal.docs[key].path}`;

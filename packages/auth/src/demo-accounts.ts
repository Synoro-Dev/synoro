/**
 * The accounts a demo visitor can switch between (`/auth/demo?as=<key>`).
 * `script/seed.ts` creates them; `demoLogin` signs in only to these (or to
 * DEMO_LOGIN_EMAIL). Pure data: safe to import from the app's client code.
 */

/** The seed creates every demo account on this domain. */
export const DEMO_DOMAIN = "@example.com";

export interface DemoAccount {
  email: string;
  name: string;
  role: "owner" | "admin" | "client";
  /** What the visitor sees in the switcher. */
  label: string;
  hint: string;
  /** Where to land after signing in. */
  home: string;
}

export const DEMO_ACCOUNTS = {
  owner: {
    email: "klyuev@example.com",
    name: "Андрей Клюев",
    role: "owner",
    label: "Специалист",
    hint: "Владелец практики: оплата, клиенты, календарь",
    home: "/",
  },
  admin: {
    email: "admin.klyuev@example.com",
    name: "Мария Соколова",
    role: "admin",
    label: "Администратор",
    hint: "Баланс клиентов, бесплатные записи, блокировки",
    home: "/",
  },
  client: {
    email: "olga.petrova@example.com",
    name: "Ольга Петрова",
    role: "client",
    label: "Клиент",
    hint: "Постоянный клиент: баланс, записи, история оплат",
    home: "/bookings",
  },
  "client-empty": {
    email: "alexey.kuznetsov@example.com",
    name: "Алексей Кузнецов",
    role: "client",
    label: "Клиент без баланса",
    hint: "Консультации закончились, платёж ждёт оплаты",
    home: "/bookings",
  },
  "client-new": {
    email: "sergey.novikov@example.com",
    name: "Сергей Новиков",
    role: "client",
    label: "Новый клиент",
    hint: "Первая покупка и первая запись",
    home: "/bookings",
  },
} as const satisfies Record<string, DemoAccount>;

export type DemoAccountKey = keyof typeof DEMO_ACCOUNTS;

export function isDemoAccountKey(key: unknown): key is DemoAccountKey {
  return typeof key === "string" && Object.hasOwn(DEMO_ACCOUNTS, key);
}

export const DEMO_ACCOUNT_EMAILS: ReadonlySet<string> = new Set(
  Object.values(DEMO_ACCOUNTS).map((account) => account.email),
);

/**
 * Secrets of the visitors' `/b/<token>` links in the seeded data. The
 * database keeps only their hashes, so these fixed ones make the pages
 * reachable from the demo; they unlock nothing but fake bookings.
 */
export const DEMO_GUEST_TOKENS = {
  /** A visitor paid online and is booked. */
  paid: "demo-guest-paid-booking-0001",
  /** The visitor left the payment page: the held time was released. */
  expired: "demo-guest-expired-hold-0002",
} as const;

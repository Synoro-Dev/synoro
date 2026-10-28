import { createHash } from "node:crypto";
import { env } from "@synoro/config";
import {
  AvailabilityRule,
  account,
  and,
  Booking,
  CreditEntry,
  type Database,
  eq,
  inArray,
  Payment,
  PaymentAccount,
  PaymentPackage,
  type PaymentProvider,
  Practice,
  PracticeInvitation,
  PracticeMember,
  db as seedDb,
  user,
} from "@synoro/db";
import { hashPassword } from "better-auth/crypto";

import { DEMO_ACCOUNTS, DEMO_GUEST_TOKENS } from "../src/demo-accounts";

/**
 * `bun db:seed`: demo practice of the psychologist Андрей Клюев, to click
 * through every cabinet locally — owner, administrator and ten clients with
 * balances, two months of consultations (past and upcoming), free
 * consultations, blocked time, online payments through two providers (paid,
 * pending, declined), purchases recorded by hand, a visitor who booked and
 * paid without an account, a pending invitation.
 *
 * Idempotent: demo users (all `@example.com`) are deleted first, which
 * cascades to their practice, bookings, payments and balances. Lives in
 * `@synoro/auth` because sign-in needs Better Auth's password hash.
 *
 * Only loopback databases named synoro-demo, acme_test or test are accepted,
 * without URL query overrides or production environment flags. Each account
 * receives a fresh random password, printed for local sign-in; with
 * DEMO_LOGIN_EMAIL set the app signs in without one (`/auth/demo`).
 */

const TIME_ZONE = "Europe/Moscow";
/** Moscow is UTC+3 all year (no DST since 2014). */
const UTC_OFFSET_HOURS = 3;

const OWNER = {
  ...DEMO_ACCOUNTS.owner,
  phone: "+79161110001",
  /** The app serves it from `apps/app/public/demo`. */
  image: "/demo/klyuev.jpg",
  bio: "Клинический психолог, КПТ и схема-терапия. Тревога, выгорание, отношения. Опыт 12 лет.",
};
const ADMIN = { ...DEMO_ACCOUNTS.admin, phone: "+79161110002" };

interface Client {
  name: string;
  email: string;
  phone: string;
  /** Consultations still on the balance after the seeded bookings. */
  left: number;
  /** How often they book, relative to the others; 0 — never. */
  weight: number;
  /** Days ago the client joined; their bookings start after that. */
  joined: number;
  /** A one-off balance correction by the administrator. */
  bonus?: number;
}

const CLIENTS: Client[] = [
  {
    ...DEMO_ACCOUNTS.client,
    phone: "+79162220001",
    left: 3,
    weight: 3,
    joined: 56,
  },
  {
    name: "Дмитрий Иванов",
    email: "dmitry.ivanov@example.com",
    phone: "+79162220002",
    left: 1,
    weight: 2,
    joined: 52,
    bonus: 1,
  },
  {
    name: "Екатерина Смирнова",
    email: "ekaterina.smirnova@example.com",
    phone: "+79162220003",
    left: 5,
    weight: 3,
    joined: 56,
  },
  {
    ...DEMO_ACCOUNTS["client-empty"],
    phone: "+79162220004",
    left: 0,
    weight: 2,
    joined: 40,
  },
  {
    name: "Наталья Волкова",
    email: "natalia.volkova@example.com",
    phone: "+79162220005",
    left: 2,
    weight: 2,
    joined: 48,
  },
  {
    ...DEMO_ACCOUNTS["client-new"],
    phone: "+79162220006",
    left: 0,
    weight: 1,
    joined: 6,
  },
  {
    name: "Анна Белова",
    email: "anna.belova@example.com",
    phone: "+79162220007",
    left: 4,
    weight: 2,
    joined: 35,
  },
  {
    name: "Михаил Орлов",
    email: "mikhail.orlov@example.com",
    phone: "+79162220008",
    left: 0,
    weight: 0,
    joined: 12,
  },
  {
    name: "Юлия Захарова",
    email: "yulia.zakharova@example.com",
    phone: "+79162220009",
    left: 2,
    weight: 2,
    joined: 28,
  },
  {
    name: "Виктор Андреев",
    email: "viktor.andreev@example.com",
    phone: "+79162220010",
    left: 8,
    weight: 1,
    joined: 50,
  },
];
const INVITED_EMAILS = ["new.client@example.com", "pavel.new@example.com"];

/** Visitors who booked from the public page without an account. */
const GUEST_CLIENTS = [
  {
    name: "Игорь Попов",
    email: "igor.popov@example.com",
    phone: "+79163330011",
  },
  {
    name: "Ксения Лаптева",
    email: "ksenia.lapteva@example.com",
    phone: "+79163330012",
  },
];

/** Mon–Thu 10–13 and 15–19, Fri 10–16, Sat 11–15; Sunday off. */
const RULES = [
  ...[1, 2, 3, 4].flatMap((weekday) => [
    { weekday, start: 10, end: 13 },
    { weekday, start: 15, end: 19 },
  ]),
  { weekday: 5, start: 10, end: 16 },
  { weekday: 6, start: 11, end: 15 },
];

/** What a client can buy: size → price in kopecks. */
const PACKAGES = [
  { credits: 1, price: 350_000 },
  { credits: 5, price: 1_600_000 },
  { credits: 10, price: 3_000_000 },
] as const;
const priceOf = (credits: number) =>
  PACKAGES.find((p) => p.credits === credits)?.price ?? credits * 350_000;

/** Weekly blocks, by ISO weekday. */
const BLOCKS: Record<number, { hour: number; hours: number; note: string }> = {
  2: { hour: 10, hours: 2, note: "Супервизия" },
  4: { hour: 17, hours: 2, note: "Личная терапия" },
};
/** Weekly free 30-minute consultations: ISO weekday → hour. */
const FREE_SLOTS: Record<number, number> = { 1: 15.5, 3: 15, 6: 13 };
const GUESTS = [
  { name: "Ирина Лебедева", phone: "+79161234567", contact: undefined },
  { name: "Павел Морозов", phone: "+79163334455", contact: "@pavel_morozov" },
  {
    name: "Светлана Орлова",
    phone: "+79165556677",
    contact: "svetlana.orlova@example.com",
  },
  { name: "Артём Фомин", phone: "+79167778899", contact: "@artem_fomin" },
];
const NOTES = [
  "Тревога перед публичными выступлениями",
  null,
  "Продолжаем работу с выгоранием",
  null,
  "Хочу обсудить отношения с родителями",
  null,
  "Трудности с границами на работе",
  "Нарушился сон, нужна поддержка",
  null,
];
const MANUAL_NOTES = [
  "Перевод на карту",
  "Наличными на приёме",
  "Оплата по QR-коду",
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAST_DAYS = 42;
const FUTURE_DAYS = 21;
/** Practice created and cash payments recorded by hand since this day. */
const STARTED_DAYS_AGO = PAST_DAYS + 14;
/** Online payments since this day: ЮKassa, then Т-Банк from the switch. */
const ONLINE_SINCE_DAYS_AGO = 45;
const PROVIDER_SWITCH_DAYS_AGO = 21;

const demoEmails = [
  OWNER.email,
  ADMIN.email,
  ...CLIENTS.map((c) => c.email),
  ...GUEST_CLIENTS.map((c) => c.email),
];

/** Small deterministic generator: the same day always gets the same plan. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Moscow's current date, as UTC midnight of that calendar day. */
function moscowToday() {
  const local = new Date(Date.now() + UTC_OFFSET_HOURS * HOUR_MS);
  return Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
}

function moscowTime(dayStart: number, hour: number) {
  return new Date(dayStart + (hour - UTC_OFFSET_HOURS) * HOUR_MS);
}

/** ISO weekday (1 = Monday) of a UTC-midnight day start. */
function isoWeekday(dayStart: number) {
  return ((new Date(dayStart).getUTCDay() + 6) % 7) + 1;
}

const fits = (weekday: number, hour: number, hours: number) =>
  RULES.some(
    (r) => r.weekday === weekday && r.start <= hour && hour + hours <= r.end,
  );

const guestTokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** 11 → 10 + 1, 8 → 5 + 1 + 1 + 1: the packages a client might have bought. */
function splitIntoPackages(total: number) {
  const sizes: number[] = [];
  let rest = total;
  for (const { credits } of [...PACKAGES].reverse()) {
    while (rest >= credits) {
      sizes.push(credits);
      rest -= credits;
    }
  }
  return sizes;
}

const providerAt = (daysAgo: number): PaymentProvider =>
  daysAgo > PROVIDER_SWITCH_DAYS_AGO ? "yookassa" : "tbank";

async function createUser(
  db: Database,
  data: {
    name: string;
    email: string;
    phone: string;
    bio?: string;
    image?: string;
  },
  createdAt: Date,
  passwords?: Map<string, string>,
) {
  const id = crypto.randomUUID();
  await db.insert(user).values({
    id,
    name: data.name,
    email: data.email,
    // A visitor's passive account is never verified or given a password.
    emailVerified: !!passwords,
    phone: data.phone,
    bio: data.bio,
    image: data.image,
    language: "ru",
    createdAt,
    updatedAt: createdAt,
  });
  if (passwords) {
    const password = crypto.randomUUID();
    await db.insert(account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
      createdAt,
      updatedAt: createdAt,
    });
    passwords.set(data.email, password);
  }
  return id;
}

type BookingRow = typeof Booking.$inferInsert & { id: string };
type PaymentRow = typeof Payment.$inferInsert & { id: string };
type CreditRow = typeof CreditEntry.$inferInsert;

/**
 * Creates the demo practice with its users, bookings, payments and balances,
 * around today's date. Callers decide where it is allowed to run.
 */
export async function seedDemoPractice(db: Database) {
  const now = Date.now();
  const today = moscowToday();
  const ago = (days: number) => new Date(now - days * DAY_MS);
  const longAgo = ago(STARTED_DAYS_AGO);

  const demoPractice = await db.query.Practice.findFirst({
    where: and(
      eq(Practice.slug, "klyuev"),
      inArray(
        Practice.ownerId,
        db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, OWNER.email)),
      ),
    ),
    columns: { id: true },
  });
  if (demoPractice) {
    await db
      .delete(PracticeInvitation)
      .where(
        and(
          eq(PracticeInvitation.practiceId, demoPractice.id),
          inArray(PracticeInvitation.email, INVITED_EMAILS),
        ),
      );
  }
  await db.delete(user).where(inArray(user.email, demoEmails));

  const passwords = new Map<string, string>();
  const ownerId = await createUser(db, OWNER, longAgo, passwords);
  const adminId = await createUser(db, ADMIN, longAgo, passwords);
  const clientUserIds: string[] = [];
  for (const client of CLIENTS) {
    clientUserIds.push(
      await createUser(db, client, ago(client.joined), passwords),
    );
  }
  const guestUserIds: string[] = [];
  for (const guest of GUEST_CLIENTS) {
    guestUserIds.push(await createUser(db, guest, ago(4)));
  }

  const [practice] = await db
    .insert(Practice)
    .values({
      name: "Андрей Клюев — психолог",
      slug: "klyuev",
      timezone: TIME_ZONE,
      profession: "psychologist",
      ownerId,
      createdAt: longAgo,
    })
    .returning();
  if (!practice) throw new Error("Failed to insert practice");

  await db.insert(AvailabilityRule).values(
    RULES.map((r) => ({
      practiceId: practice.id,
      weekday: r.weekday,
      startMinute: r.start * 60,
      endMinute: r.end * 60,
    })),
  );

  await db.insert(PracticeMember).values([
    { practiceId: practice.id, userId: ownerId, role: "owner" as const },
    { practiceId: practice.id, userId: adminId, role: "admin" as const },
  ]);
  const members = await db
    .insert(PracticeMember)
    .values(
      clientUserIds.map((userId, i) => ({
        practiceId: practice.id,
        userId,
        role: "client" as const,
        createdAt: ago(CLIENTS[i]?.joined ?? 0),
      })),
    )
    .returning({ id: PracticeMember.id });
  const guestMembers = await db
    .insert(PracticeMember)
    .values(
      guestUserIds.map((userId) => ({
        practiceId: practice.id,
        userId,
        role: "client" as const,
        createdAt: ago(4),
      })),
    )
    .returning({ id: PracticeMember.id });

  // Online payments: the first account (ЮKassa) was replaced by the second
  // (Т-Банк) three weeks ago; both are demo shops with no real keys.
  await db
    .insert(PaymentPackage)
    .values(PACKAGES.map((pkg) => ({ practiceId: practice.id, ...pkg })));
  const [yookassaAccount, tbankAccount] = await db
    .insert(PaymentAccount)
    .values([
      {
        practiceId: practice.id,
        provider: "yookassa" as const,
        merchantId: "demo-shop-501234",
        secret: "demo",
        test: true,
        active: false,
        receipts: true,
        taxSystem: "usn_income" as const,
        createdAt: ago(ONLINE_SINCE_DAYS_AGO),
        updatedAt: ago(PROVIDER_SWITCH_DAYS_AGO),
      },
      {
        practiceId: practice.id,
        provider: "tbank" as const,
        merchantId: "demo-terminal-1700000000",
        secret: "demo",
        test: true,
        active: true,
        receipts: true,
        taxSystem: "usn_income" as const,
        createdAt: ago(PROVIDER_SWITCH_DAYS_AGO),
      },
    ])
    .returning({ id: PaymentAccount.id });
  if (!yookassaAccount || !tbankAccount) {
    throw new Error("Failed to insert payment accounts");
  }
  const accountIds = {
    yookassa: yookassaAccount.id,
    tbank: tbankAccount.id,
  } satisfies Record<PaymentProvider, string>;

  // Calendar: walk working days from the past into the future. Cells are
  // half hours, so a 30-minute free consultation fits between hours.
  const rng = random(today / DAY_MS);
  const bookings: BookingRow[] = [];
  // Never on a Sunday: the visitor's paid booking soon, the abandoned one days ago.
  const workday = (offset: number, step: 1 | -1) => {
    let day = offset;
    while (isoWeekday(today + day * DAY_MS) === 7) day += step;
    return day;
  };
  const guestBookingDays = { paid: workday(3, 1), expired: workday(-2, -1) };
  const newClientIndex = CLIENTS.findIndex(
    (client) => client.email === DEMO_ACCOUNTS["client-new"].email,
  );
  const newClientBookingDay = workday(1, 1);
  let freeIndex = 0;
  for (let offset = -PAST_DAYS; offset < FUTURE_DAYS; offset++) {
    const day = today + offset * DAY_MS;
    const weekday = isoWeekday(day);
    if (weekday === 7) continue;
    const taken = new Set<number>();
    const occupy = (hour: number, hours: number) => {
      for (let h = hour; h < hour + hours; h += 0.5) taken.add(h);
    };
    const isFree = (hour: number, hours: number) => {
      for (let h = hour; h < hour + hours; h += 0.5) {
        if (taken.has(h)) return false;
      }
      return fits(weekday, hour, hours);
    };
    const created = (startsAt: Date, daysBefore: number) =>
      new Date(
        Math.min(startsAt.getTime() - daysBefore * DAY_MS, now - HOUR_MS),
      );
    const add = (
      entry: Omit<BookingRow, "id" | "practiceId" | "startsAt" | "endsAt">,
      hour: number,
      hours: number,
    ) => {
      const startsAt = moscowTime(day, hour);
      occupy(hour, hours);
      bookings.push({
        id: crypto.randomUUID(),
        practiceId: practice.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + hours * HOUR_MS),
        ...entry,
      });
      return startsAt;
    };

    const block = BLOCKS[weekday];
    if (block && isFree(block.hour, block.hours)) {
      const startsAt = moscowTime(day, block.hour);
      add(
        {
          kind: "blocked",
          note: block.note,
          createdById: ownerId,
          createdAt: created(startsAt, 14),
        },
        block.hour,
        block.hours,
      );
    }

    const freeHour = FREE_SLOTS[weekday];
    if (freeHour !== undefined && isFree(freeHour, 0.5)) {
      const guest = GUESTS[freeIndex++ % GUESTS.length];
      const startsAt = moscowTime(day, freeHour);
      add(
        {
          kind: "free",
          guestName: guest?.name,
          guestPhone: guest?.phone,
          guestContact: guest?.contact,
          note: "Первичная бесплатная консультация",
          createdById: adminId,
          createdAt: created(startsAt, 3),
        },
        freeHour,
        0.5,
      );
    }

    const hours = RULES.filter((r) => r.weekday === weekday).flatMap((r) =>
      Array.from({ length: r.end - r.start }, (_, i) => r.start + i),
    );

    // Visitors who booked from the public page (see "guest" below).
    for (const [key, memberIndex, hour] of [
      ["paid", 0, 12],
      ["expired", 1, 16],
    ] as const) {
      const isDay = offset === guestBookingDays[key];
      const member = guestMembers[memberIndex];
      const slot = [hour, hour + 1, hour - 1, hour + 2, ...hours].find((h) =>
        isFree(h, 1),
      );
      if (!isDay || !member || slot === undefined) continue;
      const createdAt = key === "paid" ? ago(2) : ago(2.01);
      add(
        {
          kind: "consultation",
          memberId: member.id,
          note: null,
          accessTokenHash: guestTokenHash(DEMO_GUEST_TOKENS[key]),
          createdById: guestUserIds[memberIndex],
          createdAt,
          ...(key === "expired" && {
            status: "cancelled" as const,
            holdUntil: new Date(createdAt.getTime() + 15 * 60 * 1000),
            cancelledAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
          }),
        },
        slot,
        1,
      );
    }

    // Clients fill the hours that are left: busy in the past, fewer ahead.
    const bookedToday = new Set<number>();
    // The newcomer always has a first booking and its purchase, even if the
    // random calendar never picks him. Keep his final balance at zero.
    const newClient = members[newClientIndex];
    if (offset === newClientBookingDay && newClient) {
      const slot = hours.find((hour) => isFree(hour, 1));
      if (slot !== undefined) {
        add(
          {
            kind: "consultation",
            memberId: newClient.id,
            createdById: clientUserIds[newClientIndex],
            createdAt: ago(1),
          },
          slot,
          1,
        );
        bookedToday.add(newClientIndex);
      }
    }
    const chance = (offset < 0 ? 0.55 : 0.33) * (weekday === 6 ? 0.6 : 1);
    for (const rule of RULES.filter((r) => r.weekday === weekday)) {
      for (let hour = rule.start; hour < rule.end; hour++) {
        if (!isFree(hour, 1) || rng() > chance) continue;
        const pool = CLIENTS.flatMap((client, index) =>
          client.weight > 0 &&
          !bookedToday.has(index) &&
          offset >= -client.joined + 2
            ? [{ client, index }]
            : [],
        );
        let pick = rng() * pool.reduce((sum, p) => sum + p.client.weight, 0);
        let chosen: (typeof pool)[number] | undefined;
        for (const candidate of pool) {
          pick -= candidate.client.weight;
          if (pick < 0) {
            chosen = candidate;
            break;
          }
        }
        const member = chosen && members[chosen.index];
        if (!chosen || !member) continue;
        bookedToday.add(chosen.index);

        const startsAt = moscowTime(day, hour);
        const joinedAt = ago(chosen.client.joined).getTime();
        const createdAt = new Date(
          Math.max(
            created(startsAt, 2 + rng() * 5).getTime(),
            joinedAt + HOUR_MS,
          ),
        );
        // A client with something left may cancel; never the one at zero.
        const cancelled = chosen.client.left >= 1 && rng() < 0.1;
        add(
          {
            kind: "consultation",
            memberId: member.id,
            note: NOTES[Math.floor(rng() * NOTES.length)],
            createdById: clientUserIds[chosen.index],
            createdAt,
            ...(cancelled && {
              status: "cancelled" as const,
              cancelledAt: new Date(
                Math.min(
                  Math.max(
                    startsAt.getTime() - 2 * DAY_MS,
                    createdAt.getTime(),
                  ),
                  now - HOUR_MS,
                ),
              ),
              cancelledById: clientUserIds[chosen.index],
            }),
          },
          hour,
          1,
        );
      }
    }
  }

  // Money. A client's purchases are replayed through their bookings: whenever
  // the balance would go negative they buy the next package a day before.
  // The practice took payments by hand at first, then online (ЮKassa, then
  // Т-Банк); a few single consultations are still paid in cash.
  const payments: PaymentRow[] = [];
  const credits: CreditRow[] = [];
  let tbankCounter = 0;

  const purchase = (
    memberId: string,
    userId: string | undefined,
    size: number,
    at: Date,
    bookingId?: string,
  ) => {
    const daysAgo = (now - at.getTime()) / DAY_MS;
    const manual =
      userId !== clientUserIds[newClientIndex] &&
      (daysAgo > ONLINE_SINCE_DAYS_AGO || (size === 1 && rng() < 0.25));
    if (manual) {
      credits.push({
        memberId,
        delta: size,
        reason: "purchase",
        note: MANUAL_NOTES[Math.floor(rng() * MANUAL_NOTES.length)],
        createdById: adminId,
        createdAt: at,
      });
    } else {
      const provider = providerAt(daysAgo);
      const id = crypto.randomUUID();
      payments.push({
        id,
        practiceId: practice.id,
        accountId: accountIds[provider],
        memberId,
        bookingId,
        provider,
        externalId:
          provider === "yookassa"
            ? crypto.randomUUID()
            : String(7_100_000_000 + tbankCounter++),
        status: "succeeded",
        credits: size,
        amount: priceOf(size),
        createdById: userId,
        createdAt: at,
        paidAt: new Date(at.getTime() + 2 * 60 * 1000),
      });
      credits.push({
        memberId,
        delta: size,
        reason: "purchase",
        paymentId: id,
        note: "Оплата онлайн",
        createdById: userId,
        createdAt: new Date(at.getTime() + 2 * 60 * 1000),
      });
    }
  };

  for (const [i, client] of CLIENTS.entries()) {
    const member = members[i];
    const userId = clientUserIds[i];
    if (!member) continue;
    const own = bookings.filter(
      (b) => b.kind === "consultation" && b.memberId === member.id,
    );
    const active = own.filter((b) => b.status !== "cancelled").length;
    const bonus = client.bonus ?? 0;
    const sizes = splitIntoPackages(Math.max(active + client.left - bonus, 0));

    const events = own
      .flatMap((b) => [
        { at: b.createdAt as Date, delta: -1, booking: b },
        ...(b.status === "cancelled" && b.cancelledAt
          ? [{ at: b.cancelledAt, delta: 1, booking: b }]
          : []),
      ])
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    let balance = 0;
    const joinedAt = ago(client.joined).getTime();
    for (const event of events) {
      if (event.delta < 0 && balance + event.delta < 0) {
        const size = sizes.shift() ?? 1;
        const at = new Date(
          Math.max(event.at.getTime() - DAY_MS * (0.5 + rng()), joinedAt),
        );
        purchase(member.id, userId, size, at);
        balance += size;
      }
      balance += event.delta;
      credits.push({
        memberId: member.id,
        delta: event.delta,
        reason: event.delta < 0 ? "booking" : "refund",
        bookingId: event.booking.id,
        createdById:
          event.delta < 0
            ? event.booking.createdById
            : event.booking.cancelledById,
        createdAt: event.at,
      });
    }
    // What is left on the balance was bought most recently.
    for (const size of sizes) {
      purchase(member.id, userId, size, ago(0.3 + rng() * 9));
    }
    if (bonus) {
      credits.push({
        memberId: member.id,
        delta: bonus,
        reason: "adjustment",
        note: "Компенсация за перенос консультации",
        createdById: adminId,
        createdAt: ago(10),
      });
    }
  }

  // A visitor who booked and paid online without an account: a package of 5
  // confirmed the booking and left 4 on the balance. Another one left the
  // payment page, so the held time was released and nothing was charged.
  const paidGuest = bookings.find(
    (b) => b.accessTokenHash === guestTokenHash(DEMO_GUEST_TOKENS.paid),
  );
  const guestMember = guestMembers[0];
  if (paidGuest && guestMember) {
    purchase(guestMember.id, guestUserIds[0], 5, ago(2), paidGuest.id);
    credits.push({
      memberId: guestMember.id,
      delta: -1,
      reason: "booking",
      bookingId: paidGuest.id,
      note: "Оплата онлайн",
      createdById: guestUserIds[0],
      createdAt: new Date(ago(2).getTime() + 2 * 60 * 1000),
    });
  }
  const expiredGuest = bookings.find(
    (b) => b.accessTokenHash === guestTokenHash(DEMO_GUEST_TOKENS.expired),
  );
  const expiredMember = guestMembers[1];
  if (expiredGuest && expiredMember) {
    payments.push({
      id: crypto.randomUUID(),
      practiceId: practice.id,
      accountId: accountIds.tbank,
      memberId: expiredMember.id,
      bookingId: expiredGuest.id,
      provider: "tbank",
      externalId: String(7_100_000_000 + tbankCounter++),
      status: "canceled",
      credits: 1,
      amount: priceOf(1),
      createdById: guestUserIds[1],
      createdAt: expiredGuest.createdAt,
    });
  }

  // Payments that brought no consultations: left unfinished or declined.
  const unfinished: {
    client: number;
    daysAgo: number;
    credits: number;
    status: "pending" | "canceled";
  }[] = [
    { client: 3, daysAgo: 12 / 1440, credits: 5, status: "pending" },
    { client: 8, daysAgo: 3, credits: 5, status: "pending" },
    { client: 1, daysAgo: 38, credits: 1, status: "canceled" },
    { client: 3, daysAgo: 9, credits: 1, status: "canceled" },
    { client: 8, daysAgo: 5, credits: 5, status: "canceled" },
    { client: 6, daysAgo: 16, credits: 10, status: "canceled" },
  ];
  for (const item of unfinished) {
    const member = members[item.client];
    if (!member) continue;
    const provider = providerAt(item.daysAgo);
    const externalId =
      provider === "yookassa"
        ? crypto.randomUUID()
        : String(7_100_000_000 + tbankCounter++);
    payments.push({
      id: crypto.randomUUID(),
      practiceId: practice.id,
      accountId: accountIds[provider],
      memberId: member.id,
      provider,
      externalId,
      status: item.status,
      credits: item.credits,
      amount: priceOf(item.credits),
      confirmationUrl:
        item.status === "pending"
          ? `https://example.com/demo-payment/${externalId}`
          : null,
      createdById: clientUserIds[item.client],
      createdAt: ago(item.daysAgo),
    });
  }

  const inserted = await db.insert(Booking).values(bookings).returning();
  await db.insert(Payment).values(payments);
  await db.insert(CreditEntry).values(credits);
  // The balance on the member is what its history adds up to.
  const balances = new Map<string, number>();
  for (const entry of credits) {
    balances.set(
      entry.memberId,
      (balances.get(entry.memberId) ?? 0) + entry.delta,
    );
  }
  for (const [memberId, balance] of balances) {
    await db
      .update(PracticeMember)
      .set({ credits: balance })
      .where(eq(PracticeMember.id, memberId));
  }

  await db.insert(PracticeInvitation).values(
    INVITED_EMAILS.map((email) => ({
      practiceId: practice.id,
      email,
      role: "client" as const,
      invitedById: adminId,
    })),
  );

  return { practice, inserted, passwords, payments };
}

export async function main(
  db: Database = seedDb,
  target: Pick<typeof env, "POSTGRES_URL" | "NODE_ENV" | "VERCEL_ENV"> = env,
) {
  let allowed = false;
  try {
    const url = new URL(target.POSTGRES_URL ?? "");
    allowed =
      target.NODE_ENV !== "production" &&
      target.VERCEL_ENV !== "production" &&
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["/synoro-demo", "/acme_test", "/test"].includes(url.pathname) &&
      !url.search &&
      !url.hash;
  } catch {
    // Missing or malformed connection settings are never a seed target.
  }
  if (!allowed) {
    console.error(
      "✗ Seed requires a non-production loopback Postgres database named synoro-demo, acme_test or test, without URL query overrides.",
    );
    return 1;
  }

  const { practice, inserted, passwords, payments } =
    await seedDemoPractice(db);

  const count = (kind: string) =>
    inserted.filter((b) => b.kind === kind && b.status === "active").length;
  const paid = payments.filter((p) => p.status === "succeeded");
  const rubles = paid.reduce((sum, p) => sum + p.amount, 0) / 100;
  console.log(`✓ Seeded practice "${practice.name}" → /p/${practice.slug}`);
  console.log(
    `  ${count("consultation")} consultations, ${count("free")} free, ${count("blocked")} blocked, ${inserted.filter((b) => b.status === "cancelled").length} cancelled`,
  );
  console.log(
    `  ${payments.length} online payments (${paid.length} paid for ${rubles.toLocaleString("ru-RU")} ₽, ${payments.filter((p) => p.status === "pending").length} pending, ${payments.filter((p) => p.status === "canceled").length} declined)`,
  );
  console.log(
    `  visitor pages: /b/${DEMO_GUEST_TOKENS.paid}  /b/${DEMO_GUEST_TOKENS.expired}`,
  );
  console.log("\n  Sign in (unique passwords):");
  console.log(`    owner   ${OWNER.email}  ${passwords.get(OWNER.email)}`);
  console.log(`    admin   ${ADMIN.email}  ${passwords.get(ADMIN.email)}`);
  for (const client of CLIENTS) {
    console.log(`    client  ${client.email}  ${passwords.get(client.email)}`);
  }
  return 0;
}

if (import.meta.main) process.exit(await main());

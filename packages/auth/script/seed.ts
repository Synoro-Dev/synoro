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
  Practice,
  PracticeInvitation,
  PracticeMember,
  db as seedDb,
  user,
} from "@synoro/db";
import { hashPassword } from "better-auth/crypto";

/**
 * `bun db:seed`: demo practice of the psychologist Андрей Клюев, to click
 * through the booking flow locally — schedule, clients with balances, past
 * and upcoming consultations, free consultations, blocked time, a pending
 * invitation.
 *
 * Idempotent: demo users (all `@example.com`) are deleted first, which
 * cascades to their practice, bookings and balances. Lives in `@synoro/auth`
 * because sign-in needs Better Auth's password hash.
 *
 * Only loopback databases named acme (local compose), acme_test or test
 * are accepted, without URL query overrides or production environment flags.
 * Each account receives a fresh random password, printed for local sign-in.
 */

const TIME_ZONE = "Europe/Moscow";
/** Moscow is UTC+3 all year (no DST since 2014). */
const UTC_OFFSET_HOURS = 3;

const OWNER = {
  name: "Андрей Клюев",
  email: "klyuev@example.com",
  bio: "Клинический психолог, КПТ и схема-терапия. Тревога, выгорание, отношения. Опыт 12 лет.",
};
const ADMIN = { name: "Мария Соколова", email: "admin.klyuev@example.com" };
/** `left` — consultations still on the balance after the seeded bookings. */
const CLIENTS = [
  { name: "Ольга Петрова", email: "olga.petrova@example.com", left: 3 },
  { name: "Дмитрий Иванов", email: "dmitry.ivanov@example.com", left: 1 },
  {
    name: "Екатерина Смирнова",
    email: "ekaterina.smirnova@example.com",
    left: 5,
  },
  { name: "Алексей Кузнецов", email: "alexey.kuznetsov@example.com", left: 0 },
  { name: "Наталья Волкова", email: "natalia.volkova@example.com", left: 2 },
] as const;
const INVITED_EMAIL = "new.client@example.com";

/** Mon–Thu 10–13 and 15–19, Fri 10–16, Sat 11–15; Sunday off. */
const RULES = [
  ...[1, 2, 3, 4].flatMap((weekday) => [
    { weekday, start: 10, end: 13 },
    { weekday, start: 15, end: 19 },
  ]),
  { weekday: 5, start: 10, end: 16 },
  { weekday: 6, start: 11, end: 15 },
];

type Entry =
  | { kind: "consultation"; hour: number; client: number; cancelled?: true }
  | { kind: "free"; hour: number; guest: number }
  | { kind: "blocked"; hour: number; hours: number; note: string };

/** Day plans, cycled over working days; hours are Moscow local time. */
const WEEKDAY_PLANS: Entry[][] = [
  [
    { kind: "consultation", hour: 10, client: 0 },
    { kind: "consultation", hour: 11, client: 1 },
    { kind: "free", hour: 15.5, guest: 0 },
    { kind: "consultation", hour: 17, client: 2 },
  ],
  [
    { kind: "blocked", hour: 10, hours: 2, note: "Супервизия" },
    { kind: "consultation", hour: 15, client: 3 },
    { kind: "consultation", hour: 16, client: 4, cancelled: true },
    { kind: "consultation", hour: 18, client: 0 },
  ],
  [
    { kind: "consultation", hour: 12, client: 2 },
    { kind: "free", hour: 15, guest: 1 },
    { kind: "consultation", hour: 16, client: 1 },
  ],
  [
    { kind: "consultation", hour: 10, client: 4 },
    { kind: "consultation", hour: 11, client: 3 },
    { kind: "blocked", hour: 17, hours: 2, note: "Личная терапия" },
  ],
];
const SATURDAY_PLAN: Entry[] = [
  { kind: "consultation", hour: 11, client: 2 },
  { kind: "free", hour: 13, guest: 2 },
];
const GUESTS = [
  { name: "Ирина Лебедева", contact: "+7 916 123-45-67" },
  { name: "Павел Морозов", contact: "@pavel_morozov" },
  { name: "Светлана Орлова", contact: "svetlana.orlova@example.com" },
];
const NOTES = [
  "Тревога перед публичными выступлениями",
  null,
  "Продолжаем работу с выгоранием",
  null,
  "Хочу обсудить отношения с родителями",
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAST_DAYS = 14;
const FUTURE_DAYS = 14;

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

const demoEmails = [OWNER.email, ADMIN.email, ...CLIENTS.map((c) => c.email)];

async function createUser(
  db: Database,
  data: { name: string; email: string; bio?: string },
  createdAt: Date,
  passwords: Map<string, string>,
) {
  const password = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const id = crypto.randomUUID();
  await db.insert(user).values({
    id,
    name: data.name,
    email: data.email,
    emailVerified: true,
    bio: data.bio,
    language: "ru",
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(account).values({
    id: crypto.randomUUID(),
    userId: id,
    accountId: id,
    providerId: "credential",
    password: passwordHash,
    createdAt,
    updatedAt: createdAt,
  });
  passwords.set(data.email, password);
  return id;
}

/**
 * Creates the demo practice with its users, bookings and balances, around
 * today's date. Callers decide where it is allowed to run.
 */
export async function seedDemoPractice(db: Database) {
  const today = moscowToday();
  const longAgo = new Date(today - (PAST_DAYS + 14) * DAY_MS);

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
          eq(PracticeInvitation.email, INVITED_EMAIL),
        ),
      );
  }
  await db.delete(user).where(inArray(user.email, demoEmails));

  const passwords = new Map<string, string>();
  const ownerId = await createUser(db, OWNER, longAgo, passwords);
  const adminId = await createUser(db, ADMIN, longAgo, passwords);
  const clientUserIds: string[] = [];
  for (const client of CLIENTS) {
    clientUserIds.push(await createUser(db, client, longAgo, passwords));
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
      clientUserIds.map((userId) => ({
        practiceId: practice.id,
        userId,
        role: "client" as const,
        createdAt: longAgo,
      })),
    )
    .returning({ id: PracticeMember.id });

  // Bookings: walk working days from two weeks ago to two weeks ahead.
  const bookings: (typeof Booking.$inferInsert)[] = [];
  let workday = 0;
  for (let offset = -PAST_DAYS; offset < FUTURE_DAYS; offset++) {
    const day = today + offset * DAY_MS;
    const weekday = isoWeekday(day);
    if (weekday === 7) continue;
    const dayPlan =
      weekday === 6
        ? SATURDAY_PLAN
        : (WEEKDAY_PLANS[workday++ % WEEKDAY_PLANS.length] ?? []);
    const plan =
      weekday === 5
        ? dayPlan.filter((entry) => {
            const duration =
              entry.kind === "blocked"
                ? entry.hours
                : entry.kind === "free"
                  ? 0.5
                  : 1;
            return entry.hour >= 10 && entry.hour + duration <= 16;
          })
        : dayPlan;

    for (const entry of plan) {
      const startsAt = moscowTime(day, entry.hour);
      const createdAt = new Date(startsAt.getTime() - 5 * DAY_MS);
      const base = { practiceId: practice.id, startsAt, createdAt };

      if (entry.kind === "consultation") {
        const member = members[entry.client];
        if (!member) continue;
        const cancelled = entry.cancelled === true;
        bookings.push({
          ...base,
          kind: "consultation",
          endsAt: new Date(startsAt.getTime() + HOUR_MS),
          memberId: member.id,
          note: NOTES[(offset + PAST_DAYS) % NOTES.length],
          createdById: clientUserIds[entry.client],
          ...(cancelled && {
            status: "cancelled" as const,
            cancelledAt: new Date(startsAt.getTime() - 2 * DAY_MS),
            cancelledById: clientUserIds[entry.client],
          }),
        });
      } else if (entry.kind === "free") {
        const guest = GUESTS[entry.guest];
        bookings.push({
          ...base,
          kind: "free",
          endsAt: new Date(startsAt.getTime() + HOUR_MS / 2),
          guestName: guest?.name,
          guestContact: guest?.contact,
          note: "Первичная бесплатная консультация",
          createdById: adminId,
        });
      } else {
        bookings.push({
          ...base,
          kind: "blocked",
          endsAt: new Date(startsAt.getTime() + entry.hours * HOUR_MS),
          note: entry.note,
          createdById: ownerId,
        });
      }
    }
  }
  const inserted = await db.insert(Booking).values(bookings).returning();

  // Credits: a purchased package covers every consultation plus what's left;
  // each booking spent one, each cancellation returned it.
  const credits: (typeof CreditEntry.$inferInsert)[] = [];
  for (const [i, member] of members.entries()) {
    const own = inserted.filter(
      (b) => b.kind === "consultation" && b.memberId === member.id,
    );
    const active = own.filter((b) => b.status === "active").length;
    const left = CLIENTS[i]?.left ?? 0;
    const purchased = active + left;

    credits.push({
      memberId: member.id,
      delta: purchased,
      reason: "purchase",
      note: `Пакет из ${purchased}`,
      createdById: adminId,
      createdAt: new Date(longAgo.getTime() + DAY_MS),
    });
    for (const b of own) {
      credits.push({
        memberId: member.id,
        delta: -1,
        reason: "booking",
        bookingId: b.id,
        createdById: b.createdById,
        createdAt: b.createdAt,
      });
      if (b.status === "cancelled") {
        credits.push({
          memberId: member.id,
          delta: 1,
          reason: "refund",
          bookingId: b.id,
          createdById: b.cancelledById,
          createdAt: b.cancelledAt ?? b.createdAt,
        });
      }
    }
    await db
      .update(PracticeMember)
      .set({ credits: left })
      .where(eq(PracticeMember.id, member.id));
  }
  await db.insert(CreditEntry).values(credits);

  await db.insert(PracticeInvitation).values({
    practiceId: practice.id,
    email: INVITED_EMAIL,
    role: "client",
    invitedById: adminId,
  });

  return { practice, inserted, passwords };
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
      "✗ Seed requires a non-production loopback Postgres database named acme, acme_test or test, without URL query overrides.",
    );
    return 1;
  }

  const { practice, inserted, passwords } = await seedDemoPractice(db);

  const count = (kind: string) =>
    inserted.filter((b) => b.kind === kind && b.status === "active").length;
  console.log(`✓ Seeded practice "${practice.name}" → /p/${practice.slug}`);
  console.log(
    `  ${count("consultation")} consultations, ${count("free")} free, ${count("blocked")} blocked, ${inserted.filter((b) => b.status === "cancelled").length} cancelled`,
  );
  console.log("\n  Sign in (unique passwords):");
  console.log(`    owner   ${OWNER.email}  ${passwords.get(OWNER.email)}`);
  console.log(`    admin   ${ADMIN.email}  ${passwords.get(ADMIN.email)}`);
  for (const client of CLIENTS) {
    console.log(
      `    client  ${client.email}  ${passwords.get(client.email)}  (${client.left} left)`,
    );
  }
  return 0;
}

if (import.meta.main) process.exit(await main());

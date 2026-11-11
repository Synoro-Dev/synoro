import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { eq, Practice, PracticeInvitation, user } from "@synoro/db";
import { createTestDb } from "@synoro/db/testing";
import { verifyPassword } from "better-auth/crypto";

import { DEMO_ACCOUNTS, DEMO_GUEST_TOKENS } from "../src/demo-accounts";
import { main } from "./seed";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const target = { POSTGRES_URL: "postgres://test:test@localhost:5432/test" };

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.close();
});

it("rejects unsafe targets before reading or changing the database", async () => {
  const query = spyOn(testDb.db.query.Practice, "findFirst");
  const deletion = spyOn(testDb.db, "delete");
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const config of [
      {},
      { POSTGRES_URL: "invalid" },
      { POSTGRES_URL: "https://localhost/test" },
      { POSTGRES_URL: "postgres://localhost/production" },
      { POSTGRES_URL: "postgres://remote.example/test" },
      { POSTGRES_URL: "postgres://localhost/test?host=remote.example" },
      { POSTGRES_URL: "postgres://localhost/test?database=production" },
      { ...target, NODE_ENV: "production" as const },
    ]) {
      expect(await main(testDb.db, config)).toBe(1);
    }
    expect(query).not.toHaveBeenCalled();
    expect(deletion).not.toHaveBeenCalled();
  } finally {
    query.mockRestore();
    deletion.mockRestore();
    output.mockRestore();
  }
});

it("seeds unique usable credentials, isolates invitations and respects availability on reruns", async () => {
  const { db } = testDb;
  const otherId = crypto.randomUUID();
  await db
    .insert(user)
    .values({ id: otherId, name: "Other", email: "other@example.test" });
  const [otherPractice] = await db
    .insert(Practice)
    .values({ name: "Other", slug: "other", ownerId: otherId })
    .returning();
  if (!otherPractice) throw new Error("Missing fixture");
  const [invitation] = await db
    .insert(PracticeInvitation)
    .values({
      practiceId: otherPractice.id,
      email: "new.client@example.com",
      role: "client",
      invitedById: otherId,
    })
    .returning();
  const output = spyOn(console, "log").mockImplementation(() => {});
  try {
    let previousPasswords = new Set<string>();
    for (let run = 0; run < 2; run++) {
      output.mockClear();
      expect(await main(db, target)).toBe(0);
      const credentials = output.mock.calls.flatMap(([line]) => {
        const match = String(line).match(
          /^\s+(?:owner|admin|client)\s+(\S+)\s+(\S+)/,
        );
        return match ? [{ email: match[1], password: match[2] }] : [];
      });
      // Owner, administrator and ten clients; visitors have no password.
      expect(credentials).toHaveLength(12);
      expect(new Set(credentials.map((c) => c.password)).size).toBe(12);
      const accounts = await db.query.account.findMany();
      const users = await db.query.user.findMany();
      for (const credential of credentials) {
        const seededUser = users.find((u) => u.email === credential.email);
        const account = accounts.find((a) => a.userId === seededUser?.id);
        expect(credential.password).not.toBe("demo12345");
        expect(previousPasswords.has(credential.password ?? "")).toBe(false);
        expect(
          await verifyPassword({
            password: credential.password ?? "",
            hash: account?.password ?? "",
          }),
        ).toBe(true);
      }
      previousPasswords = new Set(credentials.map((c) => c.password ?? ""));
      expect(
        await db.query.PracticeInvitation.findFirst({
          where: eq(PracticeInvitation.id, invitation?.id ?? ""),
        }),
      ).toEqual(invitation);
      const practice = await db.query.Practice.findFirst({
        where: eq(Practice.slug, "klyuev"),
      });
      expect(
        await db.query.PracticeInvitation.findMany({
          where: eq(PracticeInvitation.practiceId, practice?.id ?? ""),
        }),
      ).toHaveLength(2);
      const bookings = await db.query.Booking.findMany();
      const rules = await db.query.AvailabilityRule.findMany();
      expect(
        bookings.some(
          (b) => new Date(b.startsAt.getTime() + 3 * 3600000).getUTCDay() === 5,
        ),
      ).toBe(true);
      expect(
        bookings.some(
          (b) => new Date(b.startsAt.getTime() + 3 * 3600000).getUTCDay() === 6,
        ),
      ).toBe(true);
      for (const booking of bookings) {
        const start = new Date(booking.startsAt.getTime() + 3 * 3600000);
        const end = new Date(booking.endsAt.getTime() + 3 * 3600000);
        const startMinute = start.getUTCHours() * 60 + start.getUTCMinutes();
        const endMinute = end.getUTCHours() * 60 + end.getUTCMinutes();
        expect(
          rules.some(
            (r) =>
              r.weekday === start.getUTCDay() &&
              r.startMinute <= startMinute &&
              r.endMinute >= endMinute,
          ),
        ).toBe(true);
      }
    }
  } finally {
    output.mockRestore();
  }
});

const sha256 = (token: string) =>
  createHash("sha256").update(token).digest("hex");

it.each([
  "2026-10-26T12:00:00Z",
  "2026-10-27T12:00:00Z",
  "2026-10-28T12:00:00Z",
  "2026-10-29T12:00:00Z",
  "2026-10-30T12:00:00Z",
  "2026-10-31T12:00:00Z",
  "2026-11-01T12:00:00Z",
])("seeds payments and balances that add up on %s", async (date) => {
  const { db } = testDb;
  const now = spyOn(Date, "now").mockReturnValue(Date.parse(date));
  const output = spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await main(db, target)).toBe(0);
  } finally {
    now.mockRestore();
    output.mockRestore();
  }

  const members = await db.query.PracticeMember.findMany();
  const entries = await db.query.CreditEntry.findMany();
  const payments = await db.query.Payment.findMany();
  const accounts = await db.query.PaymentAccount.findMany();
  const bookings = await db.query.Booking.findMany();
  const users = await db.query.user.findMany();
  const memberOf = (email: string) =>
    members.find((m) => m.userId === users.find((u) => u.email === email)?.id);

  // The balance on the member row is the sum of its history, never negative.
  for (const member of members) {
    const sum = entries
      .filter((e) => e.memberId === member.id)
      .reduce((total, e) => total + e.delta, 0);
    expect(member.credits).toBe(sum);
    expect(member.credits).toBeGreaterThanOrEqual(0);
  }

  // Every cancellation says why; a no-show keeps the consultation spent.
  for (const booking of bookings) {
    expect(booking.cancelReason === null).toBe(booking.status === "active");
    const refunds = entries.filter(
      (e) => e.bookingId === booking.id && e.reason === "refund",
    );
    expect(refunds).toHaveLength(
      booking.cancelReason === "client" && booking.kind === "consultation"
        ? 1
        : 0,
    );
  }
  expect(bookings.some((b) => b.cancelReason === "no_show")).toBe(true);

  // Every paid payment credited the balance once, with the right amount.
  const prices = new Map([
    [1, 350_000],
    [5, 1_600_000],
    [10, 3_000_000],
  ]);
  for (const payment of payments) {
    expect(payment.amount).toBe(prices.get(payment.credits) ?? -1);
    const purchases = entries.filter((e) => e.paymentId === payment.id);
    if (payment.status === "succeeded") {
      expect(payment.paidAt).not.toBeNull();
      expect(purchases.map((e) => e.delta)).toEqual([payment.credits]);
    } else {
      expect(payment.paidAt).toBeNull();
      expect(purchases).toHaveLength(0);
    }
  }
  expect(new Set(payments.map((p) => p.status))).toEqual(
    new Set(["succeeded", "pending", "canceled"]),
  );
  expect(new Set(payments.map((p) => p.provider))).toEqual(
    new Set(["yookassa", "tbank"]),
  );
  // Purchases recorded by hand sit beside the online ones.
  expect(
    entries.some((e) => e.reason === "purchase" && e.paymentId === null),
  ).toBe(true);

  // One merchant account is live; the replaced one stays for old payments.
  expect(accounts.filter((a) => a.active)).toHaveLength(1);
  expect(accounts.every((a) => a.test)).toBe(true);
  expect(await db.query.PaymentPackage.findMany()).toHaveLength(3);

  // The demo personas are in the state their labels promise.
  expect(memberOf(DEMO_ACCOUNTS.client.email)?.credits).toBe(3);
  const alexey = memberOf(DEMO_ACCOUNTS["client-empty"].email);
  expect(alexey?.credits).toBe(0);
  expect(
    payments.some((p) => p.memberId === alexey?.id && p.status === "pending"),
  ).toBe(true);
  const sergey = memberOf(DEMO_ACCOUNTS["client-new"].email);
  expect(sergey?.credits).toBe(0);
  expect(
    bookings.some((b) => b.memberId === sergey?.id && b.status === "active"),
  ).toBe(true);
  expect(
    payments.some((p) => p.memberId === sergey?.id && p.status === "succeeded"),
  ).toBe(true);
  expect(
    entries.some(
      (e) =>
        e.memberId === sergey?.id &&
        e.reason === "purchase" &&
        e.paymentId === null,
    ),
  ).toBe(false);

  // The visitor who paid online without an account: confirmed, 4 credits left.
  const paid = bookings.find(
    (b) => b.accessTokenHash === sha256(DEMO_GUEST_TOKENS.paid),
  );
  expect(paid).toMatchObject({ status: "active", holdUntil: null });
  expect(
    new Date((paid?.startsAt.getTime() ?? 0) + 3 * 3600000).getUTCHours(),
  ).toBe(12);
  const guest = members.find((m) => m.id === paid?.memberId);
  expect(guest?.credits).toBe(4);
  expect(payments.find((p) => p.bookingId === paid?.id)?.status).toBe(
    "succeeded",
  );
  expect(
    (await db.query.account.findMany()).some((a) => a.userId === guest?.userId),
  ).toBe(false);

  // The one who left the payment page: time released, nothing charged.
  const expired = bookings.find(
    (b) => b.accessTokenHash === sha256(DEMO_GUEST_TOKENS.expired),
  );
  expect(expired).toMatchObject({
    status: "cancelled",
    cancelReason: "hold_expired",
  });
  expect(payments.find((p) => p.bookingId === expired?.id)?.status).toBe(
    "canceled",
  );
  const rules = await db.query.AvailabilityRule.findMany();
  for (const booking of [paid, expired]) {
    if (!booking) throw new Error("Missing guest booking");
    const start = new Date(booking.startsAt.getTime() + 3 * 3600000);
    const end = new Date(booking.endsAt.getTime() + 3 * 3600000);
    expect(
      rules.some(
        (r) =>
          r.weekday === start.getUTCDay() &&
          r.startMinute <= start.getUTCHours() * 60 &&
          r.endMinute >= end.getUTCHours() * 60,
      ),
    ).toBe(true);
    expect(
      bookings.some(
        (other) =>
          other.id !== booking.id &&
          other.startsAt < booking.endsAt &&
          other.endsAt > booking.startsAt,
      ),
    ).toBe(false);
  }
});

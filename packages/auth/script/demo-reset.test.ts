import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { eq, Practice, session, user } from "@synoro/db";
import { createTestDb } from "@synoro/db/testing";

import { isDemoResetTarget, main } from "./demo-reset";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const target = {
  POSTGRES_URL: "postgres://synoro_demo:secret@postgresql:5432/synoro_demo",
  DEMO_LOGIN_EMAIL: "klyuev@example.com",
};

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.close();
});

it("only accepts the demo database of a demo deployment", () => {
  expect(isDemoResetTarget(target)).toBe(true);
  for (const config of [
    {},
    { ...target, DEMO_LOGIN_EMAIL: undefined },
    { ...target, POSTGRES_URL: undefined },
    { ...target, POSTGRES_URL: "invalid" },
    { ...target, POSTGRES_URL: "https://postgresql/synoro_demo" },
    { ...target, POSTGRES_URL: "postgres://postgresql:5432/synoro" },
    { ...target, POSTGRES_URL: "postgres://postgresql:5432/synoro_demo2" },
    { ...target, POSTGRES_URL: `${target.POSTGRES_URL}?host=remote.example` },
    { ...target, POSTGRES_URL: `${target.POSTGRES_URL}#production` },
  ]) {
    expect(isDemoResetTarget(config)).toBe(false);
  }
});

it("refuses other targets before touching the database", async () => {
  const transaction = spyOn(testDb.db, "transaction");
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      await main(testDb.db, {
        ...target,
        POSTGRES_URL: "postgres://postgresql:5432/synoro",
      }),
    ).toBe(1);
    expect(
      await main(testDb.db, { ...target, DEMO_LOGIN_EMAIL: undefined }),
    ).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  } finally {
    transaction.mockRestore();
    output.mockRestore();
  }
});

it("wipes everything and seeds the demo practice again", async () => {
  const { db } = testDb;
  const output = spyOn(console, "log").mockImplementation(() => {});
  try {
    for (let run = 0; run < 2; run++) {
      // Leftovers of a day of visitors: an account of their own and a session.
      const visitorId = crypto.randomUUID();
      await db.insert(user).values({
        id: visitorId,
        name: "Visitor",
        email: `visitor${run}@test.local`,
      });
      await db.insert(session).values({
        id: crypto.randomUUID(),
        userId: visitorId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      expect(await main(db, target)).toBe(0);

      const users = await db.query.user.findMany();
      // Owner, administrator, ten clients and two visitors.
      expect(users).toHaveLength(14);
      expect(users.every((u) => u.email.endsWith("@example.com"))).toBe(true);
      expect(await db.query.session.findMany()).toHaveLength(0);
      const practices = await db.query.Practice.findMany();
      expect(practices.map((p) => p.slug)).toEqual(["klyuev"]);
      expect(
        await db.query.Practice.findFirst({
          where: eq(Practice.slug, "klyuev"),
        }),
      ).toBeDefined();
      expect((await db.query.Booking.findMany()).length).toBeGreaterThan(50);
      expect((await db.query.Payment.findMany()).length).toBeGreaterThan(15);
    }
  } finally {
    output.mockRestore();
  }
});

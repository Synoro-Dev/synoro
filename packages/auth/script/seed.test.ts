import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { eq, Practice, PracticeInvitation, user } from "@acme/db";
import { createTestDb } from "@acme/db/testing";
import { verifyPassword } from "better-auth/crypto";

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
      { ...target, VERCEL_ENV: "production" as const },
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
      expect(credentials).toHaveLength(7);
      expect(new Set(credentials.map((c) => c.password)).size).toBe(7);
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
      ).toHaveLength(1);
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
        if (start.getUTCDay() === 6)
          expect(startMinute).toBe(booking.kind === "consultation" ? 660 : 780);
      }
    }
  } finally {
    output.mockRestore();
  }
});

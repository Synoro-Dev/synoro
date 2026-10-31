import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import {
  Booking,
  eq,
  Payment,
  PaymentAccount,
  PracticeMember,
  Subscription,
} from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from "../practice";
import { analyticsRouter } from ".";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The hour before the test started: every time below is a whole hour. */
const NOW = Math.floor(Date.now() / HOUR) * HOUR;

let api: Awaited<ReturnType<typeof setupTestApi>>;

async function newPractice(slug: string, pro = true) {
  const owner = await createSession(api.db, { name: "Анна Иванова" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "psychologist" },
    { context: api.context(owner) },
  );
  await api.db
    .update(Subscription)
    .set({
      trialEndsAt: pro
        ? new Date(NOW + 10 * DAY)
        : new Date("2020-01-01T00:00:00Z"),
      paidUntil: null,
    })
    .where(eq(Subscription.userId, owner.user.id));
  return { owner, practiceId: practice.id };
}

async function newClient(practiceId: string, name = "Иван Петров") {
  const session = await createSession(api.db, { name });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  return { session, memberId: member.id };
}

/** A one-hour meeting that started `daysAgo` days and `hoursAgo` hours back. */
async function booking(
  practiceId: string,
  at: { daysAgo: number; hoursAgo?: number },
  values: Partial<typeof Booking.$inferInsert> = {},
) {
  const startsAt = new Date(NOW - at.daysAgo * DAY - (at.hoursAgo ?? 0) * HOUR);
  const [row] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      ...values,
    })
    .returning();
  if (!row) throw new Error("no booking");
  return row;
}

function cancelled(reason: "client" | "staff" | "no_show" | "hold_expired") {
  return {
    status: "cancelled" as const,
    cancelReason: reason,
    cancelledAt: new Date(NOW),
  };
}

async function payment(
  practiceId: string,
  daysAgo: number,
  amount: number,
  status: "succeeded" | "pending" | "canceled" = "succeeded",
) {
  const account =
    (await api.db.query.PaymentAccount.findFirst({
      where: eq(PaymentAccount.practiceId, practiceId),
    })) ??
    (
      await api.db
        .insert(PaymentAccount)
        .values({
          practiceId,
          provider: "yookassa",
          merchantId: "shop",
          secret: "secret",
        })
        .returning()
    )[0];
  if (!account) throw new Error("no account");
  await api.db.insert(Payment).values({
    practiceId,
    accountId: account.id,
    provider: "yookassa",
    status,
    credits: 4,
    amount,
    paidAt: status === "succeeded" ? new Date(NOW - daysAgo * DAY) : null,
  });
}

async function overview(
  owner: Awaited<ReturnType<typeof createSession>>,
  practiceId: string,
  days: 30 | 90 | 365 = 30,
) {
  return call(
    analyticsRouter.overview,
    { practiceId, days },
    { context: api.context(owner) },
  );
}

beforeAll(async () => {
  api = await setupTestApi();
});

afterAll(async () => {
  await api.close();
});

describe("analytics.overview access", () => {
  it("is for the owner only", async () => {
    const { practiceId } = await newPractice("analytics-access");
    const client = await newClient(practiceId);
    const stranger = await createSession(api.db);

    for (const caller of [client.session, stranger]) {
      const error = await overview(caller, practiceId).catch((e) => e);
      expect(isDefinedError(error)).toBe(true);
      expect(error.code).toBe("FORBIDDEN");
    }
  });

  it("an administrator does not see the money", async () => {
    const { practiceId } = await newPractice("analytics-admin");
    const admin = await newClient(practiceId, "Админ");
    await api.db
      .update(PracticeMember)
      .set({ role: "admin" })
      .where(eq(PracticeMember.id, admin.memberId));

    const error = await overview(admin.session, practiceId).catch((e) => e);
    expect(error.code).toBe("FORBIDDEN");
  });

  it("shows nothing without «Про»", async () => {
    const { owner, practiceId } = await newPractice("analytics-free", false);
    expect(await overview(owner, practiceId)).toEqual({
      pro: false,
      report: null,
    });
  });

  it("rejects a window that is not offered", async () => {
    const { owner, practiceId } = await newPractice("analytics-days");
    const error = await call(
      analyticsRouter.overview,
      { practiceId, days: 7 as 30 },
      { context: api.context(owner) },
    ).catch((e) => e);
    expect(error.code).toBe("BAD_REQUEST");
  });
});

describe("analytics.overview numbers", () => {
  it("counts what happened and leaves out what did not", async () => {
    const { owner, practiceId } = await newPractice("analytics-counts");
    const { memberId } = await newClient(practiceId);

    await booking(practiceId, { daysAgo: 1 }, { memberId });
    await booking(practiceId, { daysAgo: 2 }, { memberId });
    await booking(
      practiceId,
      { daysAgo: 3 },
      { kind: "free", guestName: "Гость" },
    );
    await booking(
      practiceId,
      { daysAgo: 4 },
      { memberId, ...cancelled("no_show") },
    );
    await booking(
      practiceId,
      { daysAgo: 5 },
      { memberId, ...cancelled("client") },
    );
    await booking(
      practiceId,
      { daysAgo: 6 },
      { memberId, ...cancelled("staff") },
    );
    // Not meetings: a lapsed unpaid hold, a block, an unpaid hold, the future,
    // and one in progress.
    await booking(
      practiceId,
      { daysAgo: 7 },
      { memberId, ...cancelled("hold_expired") },
    );
    await booking(practiceId, { daysAgo: 8 }, { kind: "blocked" });
    await booking(
      practiceId,
      { daysAgo: 9 },
      { memberId, holdUntil: new Date(NOW + HOUR) },
    );
    await booking(practiceId, { daysAgo: -2 }, { memberId });
    await booking(practiceId, { daysAgo: 0 }, { memberId });

    const { report } = await overview(owner, practiceId);
    expect(report?.stats).toMatchObject({
      meetings: 2,
      intros: 1,
      hours: 3,
      noShows: 1,
      cancelledByClient: 1,
      cancelledByStaff: 1,
      noShowRate: 0.25,
    });
  });

  it("has no no-show rate before there is anything to divide", async () => {
    const { owner, practiceId } = await newPractice("analytics-empty");
    const { report } = await overview(owner, practiceId);
    expect(report?.stats).toMatchObject({
      meetings: 0,
      noShowRate: null,
      revenue: 0,
      activeClients: 0,
    });
    expect(report?.load).toEqual([]);
  });

  it("compares with the stretch before", async () => {
    const { owner, practiceId } = await newPractice("analytics-previous");
    const { memberId } = await newClient(practiceId);
    await booking(practiceId, { daysAgo: 5 }, { memberId });
    await booking(practiceId, { daysAgo: 35 }, { memberId });
    await booking(practiceId, { daysAgo: 36 }, { memberId });
    // 61 days back is before both stretches of 30 days.
    await booking(practiceId, { daysAgo: 61 }, { memberId });

    const { report } = await overview(owner, practiceId);
    expect(report?.stats.meetings).toBe(1);
    expect(report?.previous.meetings).toBe(2);

    const year = await overview(owner, practiceId, 365);
    expect(year.report?.stats.meetings).toBe(4);
  });

  it("sums only online payments that went through in the window", async () => {
    const { owner, practiceId } = await newPractice("analytics-revenue");
    await payment(practiceId, 2, 300_000);
    await payment(practiceId, 10, 200_000);
    await payment(practiceId, 3, 100_000, "pending");
    await payment(practiceId, 3, 100_000, "canceled");
    await payment(practiceId, 40, 500_000);

    const { report } = await overview(owner, practiceId);
    expect(report?.stats).toMatchObject({ revenue: 500_000, payments: 2 });
    expect(report?.previous).toMatchObject({ revenue: 500_000, payments: 1 });
  });

  it("tells new clients from returning ones", async () => {
    const { owner, practiceId } = await newPractice("analytics-clients");
    const fresh = await newClient(practiceId, "Новый");
    const returning = await newClient(practiceId, "Давний");
    const gone = await newClient(practiceId, "Ушедший");
    const never = await newClient(practiceId, "Не приходил");

    await booking(practiceId, { daysAgo: 2 }, { memberId: fresh.memberId });
    await booking(practiceId, { daysAgo: 3 }, { memberId: fresh.memberId });
    await booking(
      practiceId,
      { daysAgo: 50 },
      { memberId: returning.memberId },
    );
    await booking(practiceId, { daysAgo: 4 }, { memberId: returning.memberId });
    await booking(practiceId, { daysAgo: 70 }, { memberId: gone.memberId });
    await booking(
      practiceId,
      { daysAgo: 5 },
      { memberId: never.memberId, ...cancelled("client") },
    );

    const { report } = await overview(owner, practiceId);
    expect(report?.stats).toMatchObject({ activeClients: 2, newClients: 1 });
    // 30–60 days ago only `returning` came, and that was their first time.
    expect(report?.previous).toMatchObject({ activeClients: 1, newClients: 1 });
  });

  it("does not mix practices", async () => {
    const mine = await newPractice("analytics-mine");
    const other = await newPractice("analytics-other");
    const client = await newClient(other.practiceId);
    await booking(
      other.practiceId,
      { daysAgo: 1 },
      { memberId: client.memberId },
    );
    await payment(other.practiceId, 1, 100_000);

    const { report } = await overview(mine.owner, mine.practiceId);
    expect(report?.stats).toMatchObject({
      meetings: 0,
      revenue: 0,
      activeClients: 0,
    });
  });
});

describe("analytics.overview charts", () => {
  it("gives a point for every day, empty ones included", async () => {
    const { owner, practiceId } = await newPractice("analytics-days-series");
    const { memberId } = await newClient(practiceId);
    await booking(practiceId, { daysAgo: 1 }, { memberId });
    await booking(practiceId, { daysAgo: 1, hoursAgo: 2 }, { memberId });
    await booking(practiceId, { daysAgo: 4 }, { memberId });
    await payment(practiceId, 4, 150_000);

    const { report } = await overview(owner, practiceId, 30);
    const series = report?.series;
    expect(series?.unit).toBe("day");
    // 30 days back to today, in the practice's time zone.
    expect(series?.points.length).toBeGreaterThanOrEqual(30);
    expect(series?.points.length).toBeLessThanOrEqual(32);
    expect(series?.points.reduce((sum, p) => sum + p.meetings, 0)).toBe(3);
    expect(series?.points.reduce((sum, p) => sum + p.revenue, 0)).toBe(150_000);
    const dates = series?.points.map((p) => p.date) ?? [];
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("groups long windows by week, Monday first", async () => {
    const { owner, practiceId } = await newPractice("analytics-weeks");
    const { memberId } = await newClient(practiceId);
    await booking(practiceId, { daysAgo: 2 }, { memberId });
    await booking(practiceId, { daysAgo: 20 }, { memberId });
    await booking(practiceId, { daysAgo: 80 }, { memberId });

    const { report } = await overview(owner, practiceId, 90);
    const series = report?.series;
    expect(series?.unit).toBe("week");
    for (const point of series?.points ?? []) {
      expect(new Date(`${point.date}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    expect(series?.points.reduce((sum, p) => sum + p.meetings, 0)).toBe(3);
    expect(series?.points.length).toBeGreaterThanOrEqual(13);
    expect(series?.points.length).toBeLessThanOrEqual(15);
  });

  it("reads busy hours in the practice's time zone", async () => {
    const { owner, practiceId } = await newPractice("analytics-load");
    const { memberId } = await newClient(practiceId);

    // 19:00 in Moscow on the day five days back (Moscow is UTC+3 all year).
    const day = new Date(NOW - 5 * DAY + 3 * HOUR).toISOString().slice(0, 10);
    const startsAt = new Date(`${day}T19:00:00+03:00`);
    const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    for (const shift of [0, 7]) {
      const at = new Date(startsAt.getTime() - shift * DAY);
      await api.db.insert(Booking).values({
        practiceId,
        kind: "consultation",
        memberId,
        startsAt: at,
        endsAt: new Date(at.getTime() + HOUR),
      });
    }

    const { report } = await overview(owner, practiceId);
    expect(report?.timeZone).toBe("Europe/Moscow");
    expect(report?.load).toEqual([{ weekday, hour: 19, count: 2 }]);
  });
});

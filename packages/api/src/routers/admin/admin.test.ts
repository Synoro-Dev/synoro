import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import {
  Practice,
  PracticeMember,
  Subscription,
  SubscriptionPayment,
} from "@synoro/db";

import {
  ADMIN_EMAIL,
  createSession,
  setupTestApi,
} from "../../../test/helpers";
import { adminRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(() => api.close());

describe("admin", () => {
  it("refuses anyone but an admin with a verified address", async () => {
    const someone = await createSession(api.db);
    // An ADMIN_EMAILS address claimed by a password sign-up, never confirmed.
    const unverified = await createSession(api.db, {
      email: ADMIN_EMAIL,
      role: "admin",
    });
    for (const session of [null, someone, unverified]) {
      const promise = call(adminRouter.stats.overview, undefined, {
        context: api.context(session),
      });
      await expect(promise).rejects.toMatchObject({
        code: session ? "FORBIDDEN" : "UNAUTHORIZED",
      });
    }
  });

  it("lists users, practices and payments with the owner's plan", async () => {
    const admin = await createSession(api.db, {
      role: "admin",
      emailVerified: true,
    });
    const owner = await createSession(api.db, {
      name: "Анна 100%_Иванова",
      email: "anna-owner@test.local",
    });
    const client = await createSession(api.db, { name: "Клиент Анны" });
    // Found only if the query's `%`, `_` or `\` worked as LIKE syntax.
    await createSession(api.db, { name: "Пётр 100xyz" });
    await createSession(api.db, {
      name: "Back\\slash",
      email: "bs@test.local",
    });
    await createSession(api.db, {
      name: "Backslash",
      email: "nobs@test.local",
    });
    const [practice] = await api.db
      .insert(Practice)
      .values({
        name: "Практика Анны",
        slug: "anna-admin",
        ownerId: owner.user.id,
      })
      .returning();
    if (!practice) throw new Error("no practice");
    await api.db.insert(PracticeMember).values([
      { practiceId: practice.id, userId: owner.user.id, role: "owner" },
      { practiceId: practice.id, userId: client.user.id, role: "client" },
    ]);
    const now = Date.now();
    await api.db.insert(Subscription).values({
      userId: owner.user.id,
      trialEndsAt: new Date(now - DAY),
      paidUntil: new Date(now + 30 * DAY),
    });
    const [payment] = await api.db
      .insert(SubscriptionPayment)
      .values({
        userId: owner.user.id,
        period: "month",
        amount: 14_900,
        status: "succeeded",
        paidAt: new Date(now - DAY),
      })
      .returning();
    const context = { context: api.context(admin) };

    // `%` and `_` in the query are literal, not wildcards.
    const users = await call(
      adminRouter.users.list,
      { query: "100%_" },
      context,
    );
    expect(users.total).toBe(1);
    for (const query of ["Анна%Иванова", "Анна 100__Иванова"]) {
      const wildcard = await call(adminRouter.users.list, { query }, context);
      expect(wildcard.total).toBe(0);
    }
    const slashed = await call(
      adminRouter.users.list,
      { query: "k\\s" },
      context,
    );
    expect(slashed.items.map((u) => u.email)).toEqual(["bs@test.local"]);
    expect(users.items[0]).toMatchObject({
      id: owner.user.id,
      plan: "active",
      practices: 1,
    });

    const practices = await call(
      adminRouter.practices.list,
      { query: "anna-owner@" },
      context,
    );
    expect(practices.items).toEqual([
      expect.objectContaining({
        id: practice.id,
        owner: expect.objectContaining({ id: owner.user.id }),
        plan: "active",
        clients: 1,
      }),
    ]);

    const payments = await call(
      adminRouter.payments.list,
      { query: String(payment?.number), status: "succeeded" },
      context,
    );
    expect(payments.items.map((p) => p.id)).toEqual([payment?.id ?? ""]);
    const refunded = await call(
      adminRouter.payments.list,
      { status: "refunded" },
      context,
    );
    expect(refunded.total).toBe(0);

    const card = await call(
      adminRouter.users.byId,
      { id: owner.user.id },
      context,
    );
    expect(card.plan).toMatchObject({ status: "active", autorenew: null });
    expect(card.practices).toEqual([
      expect.objectContaining({ id: practice.id, role: "owner" }),
    ]);
    expect(card.payments).toHaveLength(1);

    const overview = await call(adminRouter.stats.overview, undefined, context);
    expect(overview.pro.paying).toBe(1);
    expect(overview.revenue.month).toBe(14_900);
    expect(overview.practices.total).toBe(1);
  });

  it("reports an unknown user as NOT_FOUND", async () => {
    const admin = await createSession(api.db, {
      role: "admin",
      emailVerified: true,
    });
    const promise = call(
      adminRouter.users.byId,
      { id: "missing" },
      { context: api.context(admin) },
    );
    await expect(promise).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

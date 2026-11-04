import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import { SignIn } from "@synoro/db";

import { createSession, setupTestApi } from "../../../../test/helpers";
import { adminRouter } from "..";

let api: Awaited<ReturnType<typeof setupTestApi>>;

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(() => api.close());

const MINUTE = 60 * 1000;

describe("admin.signIns.list", () => {
  it("lists sign-ins with their place and source, and filters them", async () => {
    const admin = await createSession(api.db, {
      role: "admin",
      emailVerified: true,
    });
    const anna = await createSession(api.db, {
      name: "Анна",
      email: "anna-signin@test.local",
    });
    const boris = await createSession(api.db, {
      name: "Борис",
      email: "boris-signin@test.local",
    });
    const now = Date.now();
    await api.db.insert(SignIn).values([
      {
        userId: anna.user.id,
        ipAddress: "93.184.216.34",
        city: "Казань",
        country: "RU",
        yclid: "click1",
        utmSource: "yandex",
        utmMedium: "cpc",
        utmCampaign: "psychologist",
        createdAt: new Date(now - 3 * MINUTE),
      },
      {
        userId: anna.user.id,
        ipAddress: "93.184.216.35",
        referrerHost: "habr.com",
        createdAt: new Date(now - 2 * MINUTE),
      },
      {
        userId: boris.user.id,
        ipAddress: "203.0.113.7",
        city: "Омск",
        createdAt: new Date(now - MINUTE),
      },
      // A click with no UTM tags is still an ad.
      {
        userId: boris.user.id,
        yclid: "click2",
        referrerHost: "yandex.ru",
        createdAt: new Date(now),
      },
    ]);
    const context = api.context(admin);
    const list = (input: Parameters<typeof adminRouter.signIns.list>[0]) =>
      call(adminRouter.signIns.list, input, { context });

    const all = await list({ limit: 50, offset: 0 });
    expect(all.total).toBe(4);
    // Newest first, with the user and the kind of source.
    expect(all.items.map((item) => item.source)).toEqual([
      "ad",
      "direct",
      "referral",
      "ad",
    ]);
    expect(all.items[3]).toMatchObject({
      userName: "Анна",
      userEmail: "anna-signin@test.local",
      ipAddress: "93.184.216.34",
      city: "Казань",
      utmCampaign: "psychologist",
      yclid: "click1",
    });

    const ads = await list({ source: "ad", limit: 50, offset: 0 });
    expect(ads.total).toBe(2);
    const referrals = await list({ source: "referral", limit: 50, offset: 0 });
    expect(referrals.items.map((item) => item.referrerHost)).toEqual([
      "habr.com",
    ]);
    const direct = await list({ source: "direct", limit: 50, offset: 0 });
    expect(direct.items.map((item) => item.userName)).toEqual(["Борис"]);

    const ofAnna = await list({ userId: anna.user.id, limit: 50, offset: 0 });
    expect(ofAnna.total).toBe(2);

    // Name, email, IP and city are all searchable.
    for (const [query, total] of [
      ["Анна", 2],
      ["boris-signin", 2],
      ["203.0.113", 1],
      ["казан", 1],
    ] as const) {
      const found = await list({ query, limit: 50, offset: 0 });
      expect(found.total).toBe(total);
    }

    const page = await list({ limit: 1, offset: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(4);
  });

  it("refuses anyone but an admin", async () => {
    const someone = await createSession(api.db);
    for (const session of [null, someone]) {
      const promise = call(
        adminRouter.signIns.list,
        { limit: 50, offset: 0 },
        { context: api.context(session) },
      );
      await expect(promise).rejects.toMatchObject({
        code: session ? "FORBIDDEN" : "UNAUTHORIZED",
      });
    }
  });
});

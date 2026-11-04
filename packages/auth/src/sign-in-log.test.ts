import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { desc, eq, SignIn, user } from "@synoro/db";
import { createTestDb } from "@synoro/db/testing";
import { initAuth } from ".";
import { type Geo, isPublicIp, parseGeo } from "./geo";
import { NO_VISIT_SOURCE, readVisitSource } from "./visit-source";

const APP = "https://app.synoro.ru";

const visit = (params: Record<string, string>) =>
  `ad_visit=${encodeURIComponent(new URLSearchParams(params).toString())}`;

describe("sign-in history", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let auth: ReturnType<typeof initAuth>;
  const codes = new Map<string, string>();
  const lookups: string[] = [];

  beforeAll(async () => {
    testDb = await createTestDb();
    auth = initAuth({
      baseUrl: APP,
      productionUrl: APP,
      secret: "test-secret-0123456789-0123456789-abcdef",
      database: testDb.db,
      sendEmail: async ({ email, otp }) => {
        if (otp) codes.set(email, otp);
      },
      lookupGeo: async (ip): Promise<Geo | null> => {
        lookups.push(ip);
        return { country: "RU", region: "Москва", city: "Москва" };
      },
    });
  });
  afterAll(() => testDb.close());

  async function signIn(
    email: string,
    ip: string,
    headers: Record<string, string> = {},
  ) {
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request(`${APP}/api/auth${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: APP,
            "x-forwarded-for": ip,
            "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0",
            ...headers,
          },
          body: JSON.stringify(body),
        }),
      );
    await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const response = await post("/sign-in/email-otp", {
      email,
      otp: codes.get(email),
    });
    expect(response.status).toBe(200);
  }

  const historyOf = async (email: string) =>
    testDb.db
      .select({ row: SignIn })
      .from(SignIn)
      .innerJoin(user, eq(user.id, SignIn.userId))
      .where(eq(user.email, email))
      .orderBy(desc(SignIn.createdAt));

  it("keeps the IP, the city and the ad a visitor came from", async () => {
    const email = "ad.visitor@test.local";
    await signIn(email, "93.184.216.34", {
      cookie: [
        "ad_yclid=abc123_x",
        `ad_yclid_at=${Math.floor(Date.now() / 1000) - 60}`,
        visit({
          us: "yandex",
          um: "cpc",
          uc: "psychologist",
          uu: "555",
          lp: "/solutions/psychologist",
        }),
      ].join("; "),
    });

    const [first] = await historyOf(email);
    expect(first?.row).toMatchObject({
      method: "/sign-in/email-otp",
      ipAddress: "93.184.216.34",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0",
      country: "RU",
      city: "Москва",
      yclid: "abc123_x",
      utmSource: "yandex",
      utmMedium: "cpc",
      utmCampaign: "psychologist",
      utmContent: "555",
      referrerHost: null,
      landingPath: "/solutions/psychologist",
    });
    expect(first?.row.yclidAt).toBeInstanceOf(Date);
  });

  it("keeps the referring site of a visitor who came from no ad", async () => {
    const email = "referral@test.local";
    await signIn(email, "93.184.216.35", {
      cookie: visit({ ref: "habr.com", lp: "/" }),
    });
    const [first] = await historyOf(email);
    expect(first?.row).toMatchObject({
      yclid: null,
      utmSource: null,
      referrerHost: "habr.com",
      landingPath: "/",
    });
  });

  it("looks an address up once and writes every sign-in", async () => {
    const email = "twice@test.local";
    const before = lookups.filter((ip) => ip === "93.184.216.40").length;
    await signIn(email, "93.184.216.40");
    await signIn(email, "93.184.216.40");

    const history = await historyOf(email);
    expect(history).toHaveLength(2);
    expect(history.every(({ row }) => row.city === "Москва")).toBe(true);
    expect(lookups.filter((ip) => ip === "93.184.216.40").length - before).toBe(
      1,
    );
  });

  it("never sends a private address to the geo service", async () => {
    const email = "office@test.local";
    await signIn(email, "10.9.9.9");
    const [first] = await historyOf(email);
    expect(first?.row.ipAddress).toBe("10.9.9.9");
    expect(first?.row.city).toBeNull();
    expect(lookups).not.toContain("10.9.9.9");
  });
});

describe("visit source cookies", () => {
  const headers = (cookie: string) => new Headers({ cookie });

  it("is empty without cookies", () => {
    expect(readVisitSource(null)).toEqual(NO_VISIT_SOURCE);
    expect(readVisitSource(new Headers())).toEqual(NO_VISIT_SOURCE);
  });

  it("drops values that are not shaped like the real ones", () => {
    const source = readVisitSource(
      headers(
        [
          "ad_yclid=bad value!",
          "ad_yclid_at=99999999999",
          visit({ ref: "evil host/<script>", lp: "//evil.com", us: "a\nb" }),
        ].join("; "),
      ),
    );
    expect(source.yclid).toBeNull();
    expect(source.yclidAt).toBeNull();
    expect(source.referrerHost).toBeNull();
    expect(source.landingPath).toBeNull();
    expect(source.utmSource).toBe("ab");
  });

  it("ignores a click time in the future", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const future = Math.floor(now.getTime() / 1000) + 3600;
    const source = readVisitSource(
      headers(`ad_yclid=abc; ad_yclid_at=${future}`),
      now,
    );
    expect(source.yclid).toBe("abc");
    expect(source.yclidAt).toBeNull();
  });

  it("survives a broken percent-encoding", () => {
    expect(readVisitSource(headers("ad_visit=%E0%A4%A"))).toEqual(
      NO_VISIT_SOURCE,
    );
  });
});

describe("geo", () => {
  it("tells public addresses from private ones", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) {
      expect(isPublicIp(ip)).toBe(true);
    }
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "172.16.5.5",
      "172.31.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "unknown",
      "",
    ]) {
      expect(isPublicIp(ip)).toBe(false);
    }
    expect(isPublicIp("172.32.0.1")).toBe(true);
  });

  it("reads the answers of the supported services", () => {
    expect(
      parseGeo({
        success: true,
        country_code: "RU",
        region: "Москва",
        city: "Москва",
      }),
    ).toEqual({ country: "RU", region: "Москва", city: "Москва" });
    expect(
      parseGeo({
        status: "success",
        countryCode: "DE",
        regionName: "Berlin",
        city: "Berlin",
      }),
    ).toEqual({ country: "DE", region: "Berlin", city: "Berlin" });
    expect(parseGeo({ success: false, message: "Reserved range" })).toBeNull();
    expect(parseGeo({ status: "fail" })).toBeNull();
    expect(parseGeo({ error: true })).toBeNull();
    expect(parseGeo("nope")).toBeNull();
    expect(parseGeo({})).toBeNull();
  });
});

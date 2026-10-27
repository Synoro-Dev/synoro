import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestDb } from "@synoro/db/testing";

import { initAuth } from ".";

// app.synoro.ru is the main origin; the same app also serves synoro.ru/p/*.
const APP = "https://app.synoro.ru";
const PUBLIC = "https://synoro.ru";
const SECRET = "test-secret-0123456789-0123456789-abcdef";

describe("auth across app.synoro.ru and synoro.ru", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let shared: ReturnType<typeof initAuth>;
  let isolated: ReturnType<typeof initAuth>;

  beforeAll(async () => {
    testDb = await createTestDb();
    shared = initAuth({
      baseUrl: APP,
      productionUrl: APP,
      secret: SECRET,
      database: testDb.db,
      cookieDomain: ".synoro.ru",
      trustedOrigins: [PUBLIC],
    });
    // Default setup: host-only cookie, only baseUrl trusted.
    isolated = initAuth({
      baseUrl: APP,
      productionUrl: APP,
      secret: SECRET,
      database: testDb.db,
    });
  });
  afterAll(() => testDb.close());

  // Sign-up is rate limited per IP: give every request its own address.
  let ip = 0;

  function signUp(
    auth: ReturnType<typeof initAuth>,
    email: string,
    origin: string,
    callbackURL?: string,
  ) {
    return auth.handler(
      new Request(`${APP}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          "x-forwarded-for": `10.0.0.${++ip}`,
        },
        body: JSON.stringify({
          email,
          password: "test-password-123",
          name: "Test",
          callbackURL,
        }),
      }),
    );
  }

  it("shares the session cookie on the parent domain", async () => {
    const response = await signUp(shared, "shared@test.local", APP);

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.includes("session_token"));
    expect(session).toBeDefined();
    expect(session).toMatch(/Domain=\.?synoro\.ru/i);
    expect(session).toContain("__Secure-");
  });

  it("keeps the cookie host-only without cookieDomain", async () => {
    const response = await signUp(isolated, "isolated@test.local", APP);

    expect(response.status).toBe(200);
    const session = response.headers
      .getSetCookie()
      .find((c) => c.includes("session_token"));
    expect(session).toBeDefined();
    expect(session).not.toMatch(/Domain=/i);
  });

  it("accepts the public origin and its callback URLs", async () => {
    const response = await signUp(
      shared,
      "public@test.local",
      PUBLIC,
      `${PUBLIC}/p/anna`,
    );

    expect(response.status).toBe(200);
  });

  it("rejects the public origin when it is not trusted", async () => {
    const response = await signUp(
      isolated,
      "untrusted@test.local",
      PUBLIC,
      `${PUBLIC}/p/anna`,
    );

    expect(response.status).toBe(403);
  });

  it("checks the Origin of requests that carry the session cookie", async () => {
    const cookie = (await signUp(shared, "cookie@test.local", APP)).headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const signOut = (auth: ReturnType<typeof initAuth>, origin: string) =>
      auth.handler(
        new Request(`${APP}/api/auth/sign-out`, {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie },
          body: "{}",
        }),
      );

    expect((await signOut(shared, PUBLIC)).status).toBe(200);
    expect((await signOut(isolated, PUBLIC)).status).toBe(403);
    expect((await signOut(shared, "https://evil.example")).status).toBe(403);
  });

  it("still rejects unknown callback URLs", async () => {
    const callback = await signUp(
      shared,
      "evil-callback@test.local",
      APP,
      "https://evil.example/p/anna",
    );
    expect(callback.status).toBe(403);
  });
});

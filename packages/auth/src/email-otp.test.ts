import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestDb } from "@synoro/db/testing";

import { initAuth } from ".";

const APP = "https://app.synoro.ru";

describe("sign-in with an emailed code", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let auth: ReturnType<typeof initAuth>;
  const codes = new Map<string, string>();

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
    });
  });
  afterAll(() => testDb.close());

  // Auth endpoints are rate limited per IP: give every request its own one.
  let ip = 0;

  function post(path: string, body: unknown) {
    return auth.handler(
      new Request(`${APP}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: APP,
          "x-forwarded-for": `10.1.0.${++ip}`,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("mails a 6-digit code and signs a new address up with it", async () => {
    const email = "new.client@test.local";
    const sent = await post("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    expect(sent.status).toBe(200);
    const otp = codes.get(email);
    expect(otp).toMatch(/^\d{6}$/);

    const signIn = await post("/sign-in/email-otp", { email, otp });
    expect(signIn.status).toBe(200);
    expect(
      signIn.headers.getSetCookie().some((c) => c.includes("session_token")),
    ).toBe(true);
    const { user } = (await signIn.json()) as { user: { name: string } };
    // Named after the address instead of Better Auth's empty name.
    expect(user.name).toBe("new.client");
  });

  it("rejects a wrong code", async () => {
    const email = "wrong-code@test.local";
    await post("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    const otp = codes.get(email) === "000000" ? "111111" : "000000";

    const signIn = await post("/sign-in/email-otp", { email, otp });
    expect(signIn.status).toBe(400);
    expect(((await signIn.json()) as { code: string }).code).toBe(
      "INVALID_OTP",
    );
  });
});

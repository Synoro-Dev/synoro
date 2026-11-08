import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { paths } from "@synoro/config";
import { createTestDb } from "@synoro/db/testing";

import { initAuth } from ".";

const APP = "https://app.synoro.ru";

describe("onUserCreated", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let auth: ReturnType<typeof initAuth>;
  let otp = "";
  const created: { id: string; name: string; email: string }[] = [];
  let hookFails = false;

  beforeAll(async () => {
    testDb = await createTestDb();
    auth = initAuth({
      baseUrl: APP,
      productionUrl: APP,
      secret: "test-secret-0123456789-0123456789-abcdef",
      database: testDb.db,
      basePath: paths.api.auth,
      cookiePrefix: "synoro",
      sendEmail: async (data) => {
        if (data.otp) otp = data.otp;
      },
      onUserCreated: async (user) => {
        if (hookFails) throw new Error("mail is down");
        created.push(user);
      },
    });
  });
  afterAll(() => testDb.close());

  async function signIn(email: string, ip: string) {
    const headers = {
      "content-type": "application/json",
      origin: APP,
      "x-forwarded-for": ip,
    };
    await auth.handler(
      new Request(`${APP}${paths.api.auth}/email-otp/send-verification-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, type: "sign-in" }),
      }),
    );
    return auth.handler(
      new Request(`${APP}${paths.api.auth}/sign-in/email-otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, otp }),
      }),
    );
  }

  it("is called once for a new account, not for a returning one", async () => {
    const email = "newcomer@test.local";
    expect((await signIn(email, "10.3.0.1")).status).toBe(200);
    expect((await signIn(email, "10.3.0.1")).status).toBe(200);

    const mine = created.filter((user) => user.email === email);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.name).toBe("newcomer");
  });

  it("does not break sign-up when it fails", async () => {
    hookFails = true;
    const response = await signIn("unlucky@test.local", "10.3.0.2");
    hookFails = false;
    expect(response.status).toBe(200);
  });
});

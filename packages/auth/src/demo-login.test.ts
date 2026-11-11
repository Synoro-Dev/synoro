import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestDb } from "@synoro/db/testing";

import { initAuth } from ".";
import { DEMO_ACCOUNTS } from "./demo-accounts";

const APP = "https://demo.synoro.ru";
const SECRET = "test-secret-0123456789-0123456789-abcdef";
const DEMO = "klyuev@example.com";

describe("demo sign-in", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  const create = (demoLoginEmail?: string) =>
    initAuth({
      baseUrl: APP,
      productionUrl: APP,
      secret: SECRET,
      database: testDb.db,
      cookiePrefix: "synoro-demo",
      demoLoginEmail,
    });

  async function addUser(
    auth: ReturnType<typeof create>,
    email: string,
    role?: string,
  ) {
    const { internalAdapter } = await auth.$context;
    await internalAdapter.createUser({
      email,
      name: email,
      emailVerified: true,
      ...(role && { role }),
    });
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    const auth = create(DEMO);
    await addUser(auth, DEMO);
    await addUser(auth, DEMO_ACCOUNTS.client.email);
    await addUser(auth, "someone@synoro.ru");
    await addUser(auth, "root@example.com", "admin");
  });
  afterAll(() => testDb.close());

  const signIn = (auth: ReturnType<typeof create>, email?: string) =>
    auth.api.signInDemo({
      headers: new Headers(),
      returnHeaders: true,
      ...(email && { body: { email } }),
    });

  it("opens a session for the demo account", async () => {
    const { headers, response } = await signIn(create(DEMO));

    expect(response).toEqual({ ok: true });
    const cookie = headers
      .getSetCookie()
      .find((c) => c.includes("session_token"));
    expect(cookie).toStartWith("__Secure-synoro-demo.session_token=");
  });

  it("switches to another seeded demo account", async () => {
    const auth = create(DEMO);
    const { headers, response } = await signIn(
      auth,
      DEMO_ACCOUNTS.client.email,
    );

    expect(response).toEqual({ ok: true });
    expect(
      headers.getSetCookie().some((c) => c.includes("session_token")),
    ).toBe(true);
    const { internalAdapter } = await auth.$context;
    const found = await internalAdapter.findUserByEmail(
      DEMO_ACCOUNTS.client.email,
    );
    const sessions = await internalAdapter.listSessions(found?.user.id ?? "");
    expect(sessions).toHaveLength(1);
  });

  it("refuses any other account in the body", async () => {
    for (const email of ["someone@synoro.ru", "root@example.com"]) {
      await expect(signIn(create(DEMO), email)).rejects.toMatchObject({
        statusCode: 404,
      });
    }
  });

  it("does not exist without DEMO_LOGIN_EMAIL", async () => {
    await expect(signIn(create())).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      signIn(create(), DEMO_ACCOUNTS.client.email),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("answers 503 while the demo account is being re-seeded", async () => {
    await expect(signIn(create("missing@example.com"))).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("refuses real and admin accounts", async () => {
    await expect(signIn(create("someone@synoro.ru"))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(signIn(create("root@example.com"))).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("is not reachable over HTTP", async () => {
    const response = await create(DEMO).handler(
      new Request(`${APP}/api/auth/sign-in/demo`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP },
        body: "{}",
      }),
    );

    expect(response.status).toBe(404);
  });
});

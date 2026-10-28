import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  spyOn,
} from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { eq, Subscription, SubscriptionPayment } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { handleBillingWebhook } from "../../lib/billing";
import { paymentRouter } from "../payment";
import { practiceRouter } from "../practice";
import { billingRouter } from ".";

const DAY_MS = 24 * 60 * 60 * 1000;

let api: Awaited<ReturnType<typeof setupTestApi>>;
let fetchMock: Mock<typeof fetch>;

/** Точка's answers by operation: `status` and `amount` (rubles). */
const operations = new Map<string, { status: string; amount: number }>();
let requests: { method: string; url: string; body: unknown }[] = [];

function tochka() {
  fetchMock.mockImplementation((async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method: init.method ?? "GET", url, body });
    if (init.method === "POST") {
      const operationId = `op-${operations.size + 1}`;
      operations.set(operationId, {
        status: "CREATED",
        amount: body.Data.amount,
      });
      return Response.json({
        Data: {
          ...body.Data,
          operationId,
          status: "CREATED",
          paymentLink: `https://merch.tochka.com/order/?uuid=${operationId}`,
        },
      });
    }
    const operationId = decodeURIComponent(url.split("/").pop() ?? "");
    const operation = operations.get(operationId);
    if (!operation) return Response.json({ message: "nope" }, { status: 404 });
    return Response.json({
      Data: {
        Operation: [
          {
            operationId,
            ...operation,
            paymentLink: `https://merch.tochka.com/order/?uuid=${operationId}`,
          },
        ],
      },
    });
  }) as typeof fetch);
}

async function specialist(slug: string) {
  const session = await createSession(api.db, { email: `${slug}@test.local` });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "tutor" },
    { context: api.context(session) },
  );
  return { session, practiceId: practice.id };
}

function subscriptionOf(session: Session) {
  return api.db.query.Subscription.findFirst({
    where: eq(Subscription.userId, session.user.id),
  });
}

/** Moves the trial into the past: «Про» lapses unless paid. */
async function endTrial(session: Session) {
  await api.db
    .update(Subscription)
    .set({ trialEndsAt: new Date(Date.now() - DAY_MS) })
    .where(eq(Subscription.userId, session.user.id));
}

async function pay(session: Session, period: "month" | "year") {
  const started = await call(
    billingRouter.checkout,
    { period },
    { context: api.context(session) },
  );
  const payment = await api.db.query.SubscriptionPayment.findFirst({
    where: eq(SubscriptionPayment.id, started.paymentId),
  });
  if (!payment?.externalId) throw new Error("No operation id");
  return { ...started, operationId: payment.externalId };
}

function webhookJwt(claims: Record<string, unknown>) {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
}

function webhook(body: string) {
  return handleBillingWebhook(
    new Request("http://localhost/api/billing/tochka", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    }),
    api.db,
  );
}

beforeAll(async () => {
  api = await setupTestApi();
  fetchMock = spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchMock.mockReset();
  requests = [];
});
afterAll(async () => {
  fetchMock.mockRestore();
  await api.close();
});

describe("trial", () => {
  it("starts with the first practice and lasts 14 days", async () => {
    const { session } = await specialist("trial-anna");
    const before = await subscriptionOf(session);
    if (!before) throw new Error("No subscription");

    const left = before.trialEndsAt.getTime() - Date.now();
    expect(left).toBeGreaterThan(14 * DAY_MS - 60_000);
    expect(left).toBeLessThanOrEqual(14 * DAY_MS);

    await call(
      practiceRouter.create,
      { name: "Вторая", slug: "trial-anna-2", profession: "tutor" },
      { context: api.context(session) },
    );
    const after = await subscriptionOf(session);
    expect(after?.trialEndsAt).toEqual(before.trialEndsAt);

    const billing = await call(billingRouter.get, undefined, {
      context: api.context(session),
    });
    expect(billing.plan).toMatchObject({ status: "trial", pro: true });
    expect(billing.prices.month.amount).toBe(149_00);
    expect(billing.prices.year.amount).toBe(1490_00);
    expect(billing.available).toBe(true);
  });

  it("is none for a user without a practice", async () => {
    const client = await createSession(api.db);
    const billing = await call(billingRouter.get, undefined, {
      context: api.context(client),
    });
    expect(billing.plan).toMatchObject({ status: "none", pro: false });
  });
});

describe("paying for «Про» through Точка", () => {
  it("disables checkout and link creation without fiscalization", async () => {
    // A fresh process keeps the env snapshot isolated from the other tests.
    const childEnv = { ...process.env };
    delete childEnv.TOCHKA_TAX_SYSTEM;
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "--no-env-file",
        "--eval",
        `import { expect, spyOn } from "bun:test";
         import { call } from "@orpc/server";
         import { createSession, setupTestApi } from ${JSON.stringify(`${import.meta.dir}/../../../test/helpers.ts`)};
         import { billingRouter } from ${JSON.stringify(`${import.meta.dir}/index.ts`)};
         import { createTochkaPayment } from ${JSON.stringify(`${import.meta.dir}/../../lib/billing/tochka.ts`)};
         const api = await setupTestApi();
         const fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected bank request"));
         try {
           const session = await createSession(api.db);
           const context = api.context(session);
           const billing = await call(billingRouter.get, undefined, { context });
           expect(billing.available).toBe(false);
           await expect(call(billingRouter.checkout, { period: "month" }, { context }))
             .rejects.toMatchObject({ code: "BILLING_UNAVAILABLE" });
           expect(await api.db.query.SubscriptionPayment.findMany()).toHaveLength(0);
           await expect(createTochkaPayment({
             orderId: "no-receipt", amount: 14900, purpose: "Про",
             itemName: "Про", email: session.user.email,
             returnUrl: "http://localhost:3000/settings/billing",
           })).rejects.toMatchObject({ kind: "credentials" });
           expect(fetchMock).not.toHaveBeenCalled();
         } finally {
           fetchMock.mockRestore();
           await api.close();
         }`,
      ],
      cwd: `${import.meta.dir}/../../..`,
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }, 30_000);

  it("opens a payment link for 149 ₽ and extends after the trial", async () => {
    tochka();
    const { session } = await specialist("pay-month");
    const trialEndsAt = (await subscriptionOf(session))?.trialEndsAt;
    if (!trialEndsAt) throw new Error("No trial");

    const started = await pay(session, "month");
    expect(started.confirmationUrl).toStartWith("https://merch.tochka.com/");
    const [create] = requests;
    expect(create?.url).toBe(
      "https://tochka.test/uapi/acquiring/v1.0/payments_with_receipt",
    );
    expect(create?.body).toMatchObject({
      Data: {
        customerCode: "300000001",
        amount: 149,
        paymentMode: ["card", "sbp"],
        paymentLinkId: started.paymentId,
        redirectUrl: `http://localhost:3000/settings/billing?payment=${started.paymentId}`,
        taxSystemCode: "usn_income",
        Client: { email: session.user.email },
        Items: [
          {
            name: "Тариф «Про» Synoro, 1 месяц",
            amount: 149,
            quantity: 1,
            vatType: "none",
            paymentMethod: "full_prepayment",
            paymentObject: "service",
            measure: "шт.",
          },
        ],
      },
    });

    const pending = await call(
      billingRouter.status,
      { paymentId: started.paymentId },
      { context: api.context(session) },
    );
    expect(pending.status).toBe("pending");

    operations.set(started.operationId, { status: "APPROVED", amount: 149 });
    const paid = await call(
      billingRouter.status,
      { paymentId: started.paymentId },
      { context: api.context(session) },
    );
    expect(paid.status).toBe("succeeded");
    expect(paid.plan.status).toBe("active");

    // The paid month starts where the trial ends, not today.
    const expected = new Date(trialEndsAt);
    expected.setMonth(expected.getMonth() + 1);
    const subscription = await subscriptionOf(session);
    expect(subscription?.paidUntil?.getTime()).toBeCloseTo(
      expected.getTime(),
      -5,
    );

    // A webhook for the same operation changes nothing.
    expect(
      (
        await webhook(
          webhookJwt({
            webhookType: "acquiringInternetPayment",
            operationId: started.operationId,
            status: "APPROVED",
          }),
        )
      ).status,
    ).toBe(200);
    expect((await subscriptionOf(session))?.paidUntil).toEqual(
      subscription?.paidUntil ?? null,
    );
  });

  it("starts a year from today once «Про» has lapsed", async () => {
    tochka();
    const { session } = await specialist("pay-year");
    await endTrial(session);

    const { operationId } = await pay(session, "year");
    expect(requests[0]?.body).toMatchObject({ Data: { amount: 1490 } });
    operations.set(operationId, { status: "APPROVED", amount: 1490 });

    const response = await webhook(
      webhookJwt({ webhookType: "acquiringInternetPayment", operationId }),
    );
    expect(response.status).toBe(200);

    const subscription = await subscriptionOf(session);
    const expected = new Date();
    expected.setFullYear(expected.getFullYear() + 1);
    expect(subscription?.paidUntil?.getTime()).toBeCloseTo(
      expected.getTime(),
      -5,
    );
    const billing = await call(billingRouter.get, undefined, {
      context: api.context(session),
    });
    expect(billing.plan).toMatchObject({ status: "active", pro: true });
    expect(billing.payments).toHaveLength(1);
  });

  it("trusts the bank, not the webhook body", async () => {
    tochka();
    const { session } = await specialist("pay-forged");
    const { paymentId, operationId } = await pay(session, "month");

    // The webhook says APPROVED, the bank still says CREATED.
    const response = await webhook(
      webhookJwt({
        webhookType: "acquiringInternetPayment",
        operationId,
        status: "APPROVED",
      }),
    );
    expect(response.status).toBe(503);
    expect(await webhook("not a jwt")).toHaveProperty("status", 200);

    // A paid amount that doesn't match ours is not taken.
    operations.set(operationId, { status: "APPROVED", amount: 1 });
    const status = await call(
      billingRouter.status,
      { paymentId },
      { context: api.context(session) },
    );
    expect(status.status).toBe("pending");
    expect((await subscriptionOf(session))?.paidUntil).toBeNull();
  });

  it("cancels an expired link", async () => {
    tochka();
    const { session } = await specialist("pay-expired");
    const { paymentId, operationId } = await pay(session, "month");
    operations.set(operationId, { status: "EXPIRED", amount: 149 });

    const status = await call(
      billingRouter.status,
      { paymentId },
      { context: api.context(session) },
    );
    expect(status.status).toBe("canceled");
    expect(status.confirmationUrl).toBeNull();
  });

  it("hides other people's payments", async () => {
    tochka();
    const { session } = await specialist("pay-private");
    const { paymentId } = await pay(session, "month");
    const stranger = await createSession(api.db);

    const error = await call(
      billingRouter.status,
      { paymentId },
      { context: api.context(stranger) },
    ).catch((e) => e);
    expect(isDefinedError(error) && error.code).toBe("NOT_FOUND");
  });

  it("returns the latest 20 paid payments despite newer unpaid links", async () => {
    const { session } = await specialist("pay-history");
    const stranger = await createSession(api.db);
    const now = Date.now();
    const paid = await api.db
      .insert(SubscriptionPayment)
      .values(
        Array.from({ length: 21 }, (_, i) => ({
          userId: session.user.id,
          period: "month" as const,
          amount: 149_00,
          status: "succeeded" as const,
          createdAt: new Date(now - (i + 1) * DAY_MS),
        })),
      )
      .returning();
    await api.db.insert(SubscriptionPayment).values([
      ...Array.from({ length: 21 }, (_, i) => ({
        userId: session.user.id,
        period: "month" as const,
        amount: 149_00,
        status: i % 2 ? ("pending" as const) : ("canceled" as const),
        createdAt: new Date(now + i),
      })),
      {
        userId: stranger.user.id,
        period: "year",
        amount: 1490_00,
        status: "succeeded",
        createdAt: new Date(now),
      },
    ]);

    const billing = await call(billingRouter.get, undefined, {
      context: api.context(session),
    });
    expect(billing.payments.map((p) => p.id)).toEqual(
      paid.slice(0, 20).map((p) => p.id),
    );
    expect(billing.payments.every((p) => p.status === "succeeded")).toBe(true);
  });
});

describe("«Про» features", () => {
  it("are closed once the trial ends unpaid", async () => {
    const { session, practiceId } = await specialist("lapsed");
    await endTrial(session);

    const connect = await call(
      paymentRouter.connect,
      {
        practiceId,
        provider: "yookassa",
        merchantId: "123456",
        secret: "test_secret",
        receipts: false,
        taxSystem: null,
      },
      { context: api.context(session) },
    ).catch((e) => e);
    expect(isDefinedError(connect) && connect.code).toBe("PLAN_REQUIRED");

    const admin = await call(
      practiceRouter.addMember,
      { practiceId, email: "helper@test.local", role: "admin" },
      { context: api.context(session) },
    ).catch((e) => e);
    expect(isDefinedError(admin) && admin.code).toBe("PLAN_REQUIRED");

    // Clients can still be invited on the free plan.
    const client = await call(
      practiceRouter.addMember,
      { practiceId, email: "client@test.local", role: "client" },
      { context: api.context(session) },
    );
    expect(client.invited).toBe(true);

    const settings = await call(
      paymentRouter.settings,
      { practiceId },
      { context: api.context(session) },
    );
    expect(settings.pro).toBe(false);
  });
});

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
import {
  CreditEntry,
  eq,
  Payment,
  PaymentAccount,
  PaymentPackage,
} from "@synoro/db";
import type { PaymentAccountFormValues } from "@synoro/validators";

import { createSession, setupTestApi } from "../../../test/helpers";
import { handlePaymentWebhook } from "../../lib/payments";
import { tbankToken } from "../../lib/payments/tbank";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { paymentRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;
let fetchMock: Mock<typeof fetch>;

type Handler = (url: string, init: RequestInit) => unknown;

/** Answers provider calls with `handler`'s JSON; records the requests. */
function provider(handler: Handler, status = 200) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  fetchMock.mockImplementation((async (input, init = {}) => {
    const url = String(input);
    calls.push({
      url,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json(handler(url, init), { status });
  }) as typeof fetch);
  return calls;
}

function connect(
  session: Session,
  input: Partial<PaymentAccountFormValues> = {},
) {
  return call(
    paymentRouter.connect,
    {
      practiceId,
      provider: "yookassa",
      merchantId: "123456",
      secret: "test_secret",
      receipts: false,
      taxSystem: null,
      ...input,
    },
    { context: api.context(session) },
  );
}

async function packageId(credits: number) {
  const list = await call(
    paymentRouter.packages,
    { practiceId },
    { context: api.context() },
  );
  const pkg = list.packages.find((p) => p.credits === credits);
  if (!pkg) throw new Error(`No package of ${credits}`);
  return pkg.id;
}

async function balance(session: Session) {
  const practice = await call(
    practiceRouter.get,
    { practiceId },
    { context: api.context(session) },
  );
  return practice.membership.credits;
}

function webhook(provider: string, body: unknown) {
  return handlePaymentWebhook(
    provider,
    new Request(`http://localhost/api/payments/${provider}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    api.db,
  );
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-pay", profession: "tutor" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  fetchMock = spyOn(globalThis, "fetch");
});
afterEach(() => fetchMock.mockReset());
afterAll(async () => {
  fetchMock.mockRestore();
  await api.close();
});

describe("payment setup", () => {
  it("is off until the owner connects a provider", async () => {
    const settings = await call(
      paymentRouter.settings,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(settings).toMatchObject({ available: true, account: null });
    expect(settings.notificationUrls.yookassa).toBe(
      "http://localhost:3000/api/payments/yookassa",
    );

    const offer = await call(
      paymentRouter.packages,
      { practiceId },
      { context: api.context() },
    );
    expect(offer.enabled).toBe(false);
  });

  it("rejects keys the provider doesn't accept", async () => {
    provider(() => ({ description: "Unauthorized" }), 401);
    const error = await connect(owner).catch((e) => e);

    expect(isDefinedError(error)).toBe(true);
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(await api.db.query.PaymentAccount.findFirst()).toBeUndefined();
  });

  it("checks ЮKassa keys with /me and stores the secret encrypted", async () => {
    const calls = provider(() => ({ account_id: "123456", test: true }));
    const settings = await connect(owner);

    expect(calls[0]?.url).toBe("https://api.yookassa.ru/v3/me");
    expect(settings.account).toMatchObject({
      provider: "yookassa",
      merchantId: "123456",
      test: true,
    });
    expect(JSON.stringify(settings)).not.toContain("test_secret");

    const row = await api.db.query.PaymentAccount.findFirst();
    expect(row?.secret.startsWith("v1:")).toBe(true);
    expect(row?.secret).not.toContain("test_secret");
  });

  it("keeps the saved secret when the owner edits other fields", async () => {
    const calls = provider(() => ({ test: true }));
    const settings = await connect(owner, { secret: "", receipts: true });

    expect(settings.account?.receipts).toBe(true);
    expect(calls).toHaveLength(1);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.Authorization).toBe(
      `Basic ${Buffer.from("123456:test_secret").toString("base64")}`,
    );
  });

  it("is the owner's: administrators and clients can't connect", async () => {
    const client = await createSession(api.db);
    await call(
      practiceRouter.join,
      { practiceId },
      { context: api.context(client) },
    );
    const error = await connect(client).catch((e) => e);
    expect(error.code).toBe("FORBIDDEN");
  });

  it("publishes the packages once both are set", async () => {
    await call(
      paymentRouter.savePackages,
      {
        practiceId,
        packages: [
          { credits: 1, price: 300_000 },
          { credits: 5, price: 1_400_000 },
        ],
      },
      { context: api.context(owner) },
    );
    const offer = await call(
      paymentRouter.packages,
      { practiceId },
      { context: api.context() },
    );
    expect(offer).toMatchObject({ enabled: true, provider: "ЮKassa" });
    expect(offer.packages.map((p) => [p.credits, p.price])).toEqual([
      [1, 300_000],
      [5, 1_400_000],
    ]);
  });
});

describe("ЮKassa checkout", () => {
  it("joins the client, creates the payment and credits it once", async () => {
    const client = await createSession(api.db, { email: "client@test.local" });
    const created = provider(() => ({
      id: "yk-1",
      status: "pending",
      confirmation: {
        type: "redirect",
        confirmation_url: "https://yoomoney.ru/checkout/yk-1",
      },
    }));
    const { paymentId, confirmationUrl } = await call(
      paymentRouter.checkout,
      { practiceId, packageId: await packageId(5) },
      { context: api.context(client) },
    );

    expect(confirmationUrl).toBe("https://yoomoney.ru/checkout/yk-1");
    expect(created[0]?.body).toMatchObject({
      amount: { value: "14000.00", currency: "RUB" },
      capture: true,
      confirmation: {
        return_url: `http://localhost:3000/bookings?payment=${paymentId}`,
      },
      description: "Оплата: 5 занятий — Анна Иванова",
      receipt: {
        customer: { email: "client@test.local" },
        items: [{ description: "Пакет: 5 занятий — Анна Иванова" }],
      },
    });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["Idempotence-Key"]).toBe(paymentId);
    expect(await balance(client)).toBe(0);

    // Back from the payment page: the status check asks ЮKassa.
    provider(() => ({ id: "yk-1", status: "succeeded" }));
    const paid = await call(
      paymentRouter.status,
      { paymentId },
      { context: api.context(client) },
    );
    expect(paid).toMatchObject({ status: "succeeded", credits: 5, balance: 5 });

    // The webhook arriving afterwards changes nothing.
    const response = await webhook("yookassa", {
      type: "notification",
      event: "payment.succeeded",
      object: { id: "yk-1", status: "succeeded" },
    });
    expect(response.status).toBe(200);
    expect(await balance(client)).toBe(5);

    const entries = await api.db.query.CreditEntry.findMany({
      where: eq(CreditEntry.paymentId, paymentId),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ delta: 5, reason: "purchase" });

    const { membership } = await call(
      practiceRouter.get,
      { practiceId },
      { context: api.context(client) },
    );
    const history = await call(
      creditRouter.history,
      { memberId: membership.id },
      { context: api.context(client) },
    );
    expect(history[0]?.reason).toBe("purchase");

    const mine = await call(paymentRouter.mine, undefined, {
      context: api.context(client),
    });
    expect(mine[0]).toMatchObject({
      status: "succeeded",
      providerName: "ЮKassa",
      resumeUrl: null,
    });
  });

  it("trusts the API, not the notification body", async () => {
    const client = await createSession(api.db);
    provider(() => ({
      id: "yk-2",
      status: "pending",
      confirmation: { type: "redirect", confirmation_url: "https://pay/yk-2" },
    }));
    await call(
      paymentRouter.checkout,
      { practiceId, packageId: await packageId(1) },
      { context: api.context(client) },
    );

    // Forged "succeeded": ЮKassa itself still says pending.
    provider(() => ({ id: "yk-2", status: "pending" }));
    await webhook("yookassa", { object: { id: "yk-2", status: "succeeded" } });
    expect(await balance(client)).toBe(0);

    provider(() => ({ id: "yk-2", status: "canceled" }));
    await webhook("yookassa", { object: { id: "yk-2" } });
    const row = await api.db.query.Payment.findFirst({
      where: eq(Payment.externalId, "yk-2"),
    });
    expect(row?.status).toBe("canceled");
    expect(await balance(client)).toBe(0);
  });

  it("drops the attempt when ЮKassa refuses it", async () => {
    const client = await createSession(api.db);
    provider(() => ({ description: "Receipt is missing" }), 400);
    const error = await call(
      paymentRouter.checkout,
      { practiceId, packageId: await packageId(1) },
      { context: api.context(client) },
    ).catch((e) => e);

    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.message).toBe("Receipt is missing");
    const mine = await call(paymentRouter.mine, undefined, {
      context: api.context(client),
    });
    expect(mine).toHaveLength(0);
  });

  it("doesn't let staff top up their own balance", async () => {
    const error = await call(
      paymentRouter.checkout,
      { practiceId, packageId: await packageId(1) },
      { context: api.context(owner) },
    ).catch((e) => e);
    expect(error.code).toBe("FORBIDDEN");
  });
});

describe("Т-Банк checkout", () => {
  const terminal = "1700000000000DEMO";

  it("switches the practice to the terminal", async () => {
    provider(() => ({ Success: false, ErrorCode: "7", Message: "Нет такого" }));
    const settings = await connect(owner, {
      provider: "tbank",
      merchantId: terminal,
      secret: "terminal_password",
      receipts: true,
      taxSystem: "usn_income",
    });
    expect(settings.account).toMatchObject({ provider: "tbank", test: true });
    expect(settings.savedProviders.sort()).toEqual(["tbank", "yookassa"]);

    const active = await api.db.query.PaymentAccount.findMany({
      where: eq(PaymentAccount.active, true),
    });
    expect(active.map((a) => a.provider)).toEqual(["tbank"]);
  });

  it("rejects a wrong terminal password", async () => {
    provider(() => ({
      Success: false,
      ErrorCode: "204",
      Message: "Неверный токен",
    }));
    const error = await connect(owner, {
      provider: "tbank",
      merchantId: terminal,
      secret: "wrong",
    }).catch((e) => e);
    expect(error.code).toBe("INVALID_CREDENTIALS");
  });

  it("settles from a signed notification and answers OK", async () => {
    const client = await createSession(api.db);
    const init = provider(() => ({
      Success: true,
      ErrorCode: "0",
      Status: "NEW",
      PaymentId: 9_000_001,
      PaymentURL: "https://securepay.tinkoff.ru/new/abc",
    }));
    const { paymentId, confirmationUrl } = await call(
      paymentRouter.checkout,
      { practiceId, packageId: await packageId(1) },
      { context: api.context(client) },
    );
    expect(confirmationUrl).toBe("https://securepay.tinkoff.ru/new/abc");

    const sent = init[0]?.body ?? {};
    expect(init[0]?.url).toBe("https://securepay.tinkoff.ru/v2/Init");
    expect(sent).toMatchObject({
      TerminalKey: terminal,
      Amount: 300_000,
      OrderId: paymentId,
      NotificationURL: "http://localhost:3000/api/payments/tbank",
      Receipt: { Taxation: "usn_income", Items: [{ Amount: 300_000 }] },
    });
    expect(sent.Token).toBe(tbankToken(sent, "terminal_password"));

    const notification: Record<string, unknown> = {
      TerminalKey: terminal,
      OrderId: paymentId,
      Success: true,
      Status: "CONFIRMED",
      PaymentId: 9_000_001,
      ErrorCode: "0",
      Amount: 300_000,
    };
    const forged = await webhook("tbank", {
      ...notification,
      Token: tbankToken(notification, "guess"),
    });
    expect(forged.status).toBe(403);
    expect(await balance(client)).toBe(0);

    notification.Token = tbankToken(notification, "terminal_password");
    for (let i = 0; i < 2; i++) {
      const response = await webhook("tbank", notification);
      expect(await response.text()).toBe("OK");
    }
    expect(await balance(client)).toBe(1);
  });

  it("lets staff see the practice's payments and monthly total", async () => {
    const result = await call(
      paymentRouter.list,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(result.month).toEqual({
      amount: 1_700_000,
      credits: 6,
      count: 2,
    });
    expect(
      result.payments.some((p) => p.clientEmail === "client@test.local"),
    ).toBe(true);
  });
});

describe("demo shop", () => {
  let demoPracticeId: string;

  beforeAll(async () => {
    const practice = await call(
      practiceRouter.create,
      { name: "Демо", slug: "demo-shop", profession: "psychologist" },
      { context: api.context(owner) },
    );
    demoPracticeId = practice.id;
    await api.db.insert(PaymentAccount).values({
      practiceId: practice.id,
      provider: "tbank",
      merchantId: "demo-terminal-1",
      secret: "demo",
      test: true,
    });
    await api.db
      .insert(PaymentPackage)
      .values({ practiceId: practice.id, credits: 5, price: 1_600_000 });
  });

  it("settles a payment at once, without calling a provider", async () => {
    const client = await createSession(api.db);
    const offer = await call(
      paymentRouter.packages,
      { practiceId: demoPracticeId },
      { context: api.context() },
    );
    expect(offer.enabled).toBe(true);

    const { paymentId, confirmationUrl } = await call(
      paymentRouter.checkout,
      { practiceId: demoPracticeId, packageId: offer.packages[0]?.id ?? "" },
      { context: api.context(client) },
    );

    expect(confirmationUrl).toBe(
      `http://localhost:3000/bookings?payment=${paymentId}`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await api.db.query.Payment.findFirst({
      where: eq(Payment.id, paymentId),
    });
    expect(row).toMatchObject({ status: "succeeded", credits: 5 });
    expect(row?.paidAt).not.toBeNull();
    const practice = await call(
      practiceRouter.get,
      { practiceId: demoPracticeId },
      { context: api.context(client) },
    );
    expect(practice.membership.credits).toBe(5);
  });
});

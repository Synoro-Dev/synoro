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
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import {
  eq,
  Subscription,
  SubscriptionAutorenewal,
  SubscriptionPayment,
} from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import { renewSubscriptions } from "@synoro/jobs/billing-renewal";
import { dueProNotice } from "@synoro/jobs/pro-notices";

import {
  ADMIN_EMAIL,
  createSession,
  setupTestApi,
} from "../../../test/helpers";
import { billingRouter } from ".";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let api: Awaited<ReturnType<typeof setupTestApi>>;
let fetchMock: Mock<typeof fetch>;
let requests: { method: string; url: string; body: unknown }[] = [];
/** Never reset: the database outlives a test, and so do its operation ids. */
const operations = new Map<string, { status: string; amount: number }>();
/** What Точка answers to a charge; tests swap it. */
let nextOperation = 1;
let lastOperation = "";
let chargeAnswer = () => Response.json({ Data: { result: true } });

function tochka() {
  fetchMock.mockImplementation((async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method: init.method ?? "GET", url, body });
    if (url.endsWith("/charge")) return chargeAnswer();
    if (url.endsWith("/refund")) {
      return Response.json({ Data: { isRefund: true } });
    }
    if (init.method === "POST") {
      const operationId = `op-${nextOperation}`;
      lastOperation = operationId;
      nextOperation += 1;
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
          { operationId, ...operation, paymentLink: "https://merch.test" },
        ],
      },
    });
  }) as typeof fetch);
}

const charges = () => requests.filter((r) => r.url.endsWith("/charge"));

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  const notices = () =>
    sent.map((m) => (m.props as unknown as { notice: string }).notice);
  return { sent, deliver, notices };
}

/**
 * A specialist whose card is bound: paid up to `paidUntil`, auto-renewal on
 * for `period`, as after a first payment with consent.
 */
async function renewing(
  email: string,
  paidUntil: Date,
  period: "month" | "year" = "month",
) {
  const session = await createSession(api.db, { email, name: "Анна" });
  await api.db.insert(Subscription).values({
    userId: session.user.id,
    trialEndsAt: new Date(paidUntil.getTime() - 60 * DAY),
    paidUntil,
  });
  await api.db.insert(SubscriptionAutorenewal).values({
    userId: session.user.id,
    externalId: `sub-${email}`,
    period,
    consentAt: new Date(paidUntil.getTime() - 40 * DAY),
  });
  return session;
}

const autorenewalOf = (session: Session) =>
  api.db.query.SubscriptionAutorenewal.findFirst({
    where: eq(SubscriptionAutorenewal.userId, session.user.id),
  });
const paymentsOf = (session: Session) =>
  api.db.query.SubscriptionPayment.findMany({
    where: eq(SubscriptionPayment.userId, session.user.id),
  });
const paidUntilOf = async (session: Session) =>
  (
    await api.db.query.Subscription.findFirst({
      where: eq(Subscription.userId, session.user.id),
    })
  )?.paidUntil;

beforeAll(async () => {
  api = await setupTestApi();
  fetchMock = spyOn(globalThis, "fetch");
});
afterEach(async () => {
  fetchMock.mockReset();
  requests = [];
  // Renewals of one test must not be picked up by the next one's run.
  await api.db.delete(SubscriptionAutorenewal);
  chargeAnswer = () => Response.json({ Data: { result: true } });
});
afterAll(async () => {
  fetchMock.mockRestore();
  await api.close();
});

describe("agreeing to auto-renewal", () => {
  it("opens a schedule-less subscription and turns renewal on once paid", async () => {
    tochka();
    const session = await createSession(api.db, { email: "agree@test.local" });
    await api.db.insert(Subscription).values({
      userId: session.user.id,
      trialEndsAt: new Date(Date.now() + 5 * DAY),
    });
    const context = api.context(session);

    const started = await call(
      billingRouter.checkout,
      { period: "month", autorenew: true },
      { context },
    );
    const [request] = requests;
    expect(request?.url).toEndWith(
      "/acquiring/v1.0/subscriptions_with_receipt",
    );
    expect(request?.body).toMatchObject({
      Data: { recurring: true, amount: 149, paymentLinkId: started.paymentId },
    });
    // A subscription link takes neither a lifetime nor payment modes.
    expect(request?.body).not.toHaveProperty("Data.ttl");
    expect(request?.body).not.toHaveProperty("Data.paymentMode");
    expect(request?.body).not.toHaveProperty("Data.Options");

    // Not on until the bank has confirmed the first payment.
    expect(await autorenewalOf(session)).toBeUndefined();

    operations.set(lastOperation, { status: "APPROVED", amount: 149 });
    const paid = await call(
      billingRouter.status,
      { paymentId: started.paymentId },
      { context },
    );
    expect(paid.status).toBe("succeeded");

    expect(await autorenewalOf(session)).toMatchObject({
      externalId: lastOperation,
      period: "month",
      status: "active",
      failedAttempts: 0,
    });
    const billing = await call(billingRouter.get, undefined, { context });
    expect(billing.autorenew).toMatchObject({
      period: "month",
      amount: 149_00,
    });
  });

  it("is off for an ordinary payment", async () => {
    tochka();
    const session = await createSession(api.db, { email: "plain@test.local" });
    await api.db.insert(Subscription).values({
      userId: session.user.id,
      trialEndsAt: new Date(Date.now() + 5 * DAY),
    });
    const context = api.context(session);

    const started = await call(
      billingRouter.checkout,
      { period: "month" },
      { context },
    );
    expect(requests[0]?.url).toEndWith("/payments_with_receipt");
    operations.set(lastOperation, { status: "APPROVED", amount: 149 });
    await call(
      billingRouter.status,
      { paymentId: started.paymentId },
      { context },
    );

    expect(await autorenewalOf(session)).toBeUndefined();
    const billing = await call(billingRouter.get, undefined, { context });
    expect(billing.autorenew).toBeNull();
  });
});

describe("charging for the next period", () => {
  it("charges once, extends from the old end, and mails the specialist", async () => {
    tochka();
    const now = new Date();
    const paidUntil = new Date(now.getTime() + 10 * HOUR);
    const session = await renewing("charge@test.local", paidUntil);
    const mail = recorder();

    await renewSubscriptions(api.db, mail.deliver, now);

    expect(charges()).toHaveLength(1);
    expect(charges()[0]).toMatchObject({
      method: "POST",
      url: "https://tochka.test/uapi/acquiring/v1.0/subscriptions/sub-charge%40test.local/charge",
      body: { Data: { amount: 149 } },
    });
    const expected = new Date(paidUntil);
    expected.setMonth(expected.getMonth() + 1);
    expect(await paidUntilOf(session)).toEqual(expected);
    const [payment] = await paymentsOf(session);
    expect(payment).toMatchObject({
      status: "succeeded",
      amount: 149_00,
      chargedFor: paidUntil,
      periodStart: paidUntil,
      externalId: null,
    });
    expect(mail.notices()).toEqual(["charged"]);
    expect(mail.sent[0]?.to).toEqual(["charge@test.local"]);

    // The period moved out of the window: another run has nothing to do.
    await renewSubscriptions(api.db, mail.deliver, now);
    expect(charges()).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });

  it("charges a year at the year price", async () => {
    tochka();
    const now = new Date();
    const session = await renewing(
      "year@test.local",
      new Date(now.getTime() + HOUR),
      "year",
    );

    await renewSubscriptions(api.db, recorder().deliver, now);

    expect(charges()[0]?.body).toEqual({ Data: { amount: 1490 } });
    const [payment] = await paymentsOf(session);
    expect(payment).toMatchObject({ period: "year", amount: 1490_00 });
  });

  it("leaves periods that are not due, canceled ones and demo ids alone", async () => {
    tochka();
    const now = new Date();
    await renewing("far@test.local", new Date(now.getTime() + 5 * DAY));
    const off = await renewing(
      "off@test.local",
      new Date(now.getTime() + HOUR),
    );
    await api.db
      .update(SubscriptionAutorenewal)
      .set({ status: "canceled", cancelReason: "user" })
      .where(eq(SubscriptionAutorenewal.userId, off.user.id));
    const fake = await renewing(
      "demo@test.local",
      new Date(now.getTime() + HOUR),
    );
    await api.db
      .update(SubscriptionAutorenewal)
      .set({ externalId: "demo-1" })
      .where(eq(SubscriptionAutorenewal.userId, fake.user.id));

    await renewSubscriptions(api.db, recorder().deliver, now);

    expect(charges()).toHaveLength(0);
  });

  it("charges a lapsed period from now, not from the missed end", async () => {
    tochka();
    const now = new Date();
    const session = await renewing(
      "late@test.local",
      new Date(now.getTime() - DAY),
    );

    await renewSubscriptions(api.db, recorder().deliver, now);

    expect(charges()).toHaveLength(1);
    const paidUntil = await paidUntilOf(session);
    expect(paidUntil?.getTime()).toBeGreaterThan(now.getTime() + 27 * DAY);
  });

  it("charges one period once when two workers run together", async () => {
    tochka();
    const now = new Date();
    const session = await renewing(
      "race@test.local",
      new Date(now.getTime() + HOUR),
    );

    await Promise.all([
      renewSubscriptions(api.db, recorder().deliver, now),
      renewSubscriptions(api.db, recorder().deliver, now),
    ]);

    expect(charges()).toHaveLength(1);
    expect(await paymentsOf(session)).toHaveLength(1);
  });
});

describe("a declined charge", () => {
  it("retries after 12 hours, then switches auto-renewal off", async () => {
    tochka();
    chargeAnswer = () => Response.json({ Data: { result: false } });
    const start = new Date();
    const paidUntil = new Date(start.getTime() + 20 * HOUR);
    const session = await renewing("decline@test.local", paidUntil);
    const mail = recorder();

    await renewSubscriptions(api.db, mail.deliver, start);
    expect(charges()).toHaveLength(1);
    expect(await autorenewalOf(session)).toMatchObject({
      status: "active",
      failedAttempts: 1,
    });
    expect(await paidUntilOf(session)).toEqual(paidUntil);
    // The failed attempt is kept as a canceled payment and frees the period.
    expect(await paymentsOf(session)).toMatchObject([
      { status: "canceled", chargedFor: null },
    ]);

    // Too soon.
    await renewSubscriptions(
      api.db,
      mail.deliver,
      new Date(start.getTime() + 6 * HOUR),
    );
    expect(charges()).toHaveLength(1);

    await renewSubscriptions(
      api.db,
      mail.deliver,
      new Date(start.getTime() + 13 * HOUR),
    );
    expect(charges()).toHaveLength(2);
    expect(await autorenewalOf(session)).toMatchObject({ failedAttempts: 2 });

    await renewSubscriptions(
      api.db,
      mail.deliver,
      new Date(start.getTime() + 26 * HOUR),
    );
    expect(charges()).toHaveLength(3);
    expect(await autorenewalOf(session)).toMatchObject({
      status: "canceled",
      cancelReason: "charge_failed",
      failedAttempts: 3,
    });
    expect(mail.notices()).toEqual(["failed", "failed", "canceled"]);

    // Off for good: no fourth attempt.
    await renewSubscriptions(
      api.db,
      mail.deliver,
      new Date(start.getTime() + 40 * HOUR),
    );
    expect(charges()).toHaveLength(3);
  });

  it("reads a 4xx from the bank as a refusal", async () => {
    tochka();
    chargeAnswer = () => Response.json({ message: "no card" }, { status: 400 });
    const now = new Date();
    const session = await renewing(
      "four@test.local",
      new Date(now.getTime() + HOUR),
    );

    await renewSubscriptions(api.db, recorder().deliver, now);

    expect(await autorenewalOf(session)).toMatchObject({ failedAttempts: 1 });
  });

  it("starts counting again after a successful charge", async () => {
    tochka();
    const now = new Date();
    const session = await renewing(
      "recover@test.local",
      new Date(now.getTime() + HOUR),
    );
    await api.db
      .update(SubscriptionAutorenewal)
      .set({ failedAttempts: 2 })
      .where(eq(SubscriptionAutorenewal.userId, session.user.id));

    await renewSubscriptions(api.db, recorder().deliver, now);

    expect(await autorenewalOf(session)).toMatchObject({ failedAttempts: 0 });
  });
});

describe("an unclear answer from the bank", () => {
  it("never charges the same period again", async () => {
    tochka();
    chargeAnswer = () => new Response("gateway", { status: 502 });
    const start = new Date();
    const session = await renewing(
      "unknown@test.local",
      new Date(start.getTime() + HOUR),
    );
    const mail = recorder();

    await renewSubscriptions(api.db, mail.deliver, start);
    chargeAnswer = () => Response.json({ Data: { result: true } });
    await renewSubscriptions(
      api.db,
      mail.deliver,
      new Date(start.getTime() + 13 * HOUR),
    );

    expect(charges()).toHaveLength(1);
    // The attempt waits for a human; the specialist isn't told anything yet.
    expect(await paymentsOf(session)).toMatchObject([
      { status: "pending", chargedFor: expect.any(Date) },
    ]);
    expect(mail.sent).toHaveLength(0);
  });

  it("forgets an attempt that never reached the bank", async () => {
    tochka();
    chargeAnswer = () => new Response("denied", { status: 401 });
    const start = new Date();
    const session = await renewing(
      "denied@test.local",
      new Date(start.getTime() + HOUR),
    );

    await renewSubscriptions(api.db, recorder().deliver, start);

    expect(await paymentsOf(session)).toHaveLength(0);
    expect(await autorenewalOf(session)).toMatchObject({
      failedAttempts: 0,
      lastAttemptAt: null,
    });

    // The key works again: the next hourly run charges, not 12 hours later.
    chargeAnswer = () => Response.json({ Data: { result: true } });
    await renewSubscriptions(
      api.db,
      recorder().deliver,
      new Date(start.getTime() + HOUR),
    );
    expect(await paymentsOf(session)).toMatchObject([{ status: "succeeded" }]);
  });
});

describe("mails about charges", () => {
  it("are delivered by a later run after a failed delivery", async () => {
    tochka();
    const start = new Date();
    const session = await renewing(
      "mail@test.local",
      new Date(start.getTime() + HOUR),
    );
    const mail = recorder();

    await renewSubscriptions(
      api.db,
      async () => {
        throw new Error("smtp down");
      },
      start,
    );
    expect(await paymentsOf(session)).toMatchObject([{ status: "succeeded" }]);
    expect(mail.sent).toHaveLength(0);

    // The period is long out of the charging window; the mail still goes.
    await renewSubscriptions(
      api.db,
      mail.deliver,
      new Date(start.getTime() + 2 * HOUR),
    );
    expect(mail.notices()).toEqual(["charged"]);

    await renewSubscriptions(
      api.db,
      mail.deliver,
      new Date(start.getTime() + 3 * HOUR),
    );
    expect(mail.sent).toHaveLength(1);
  });
});

describe("a late confirmation of an older agreement", () => {
  /** A pending first payment with consent given `consentAgo` ago. */
  async function pendingConsent(
    session: Session,
    operationId: string,
    consentAgo: number,
  ) {
    const [payment] = await api.db
      .insert(SubscriptionPayment)
      .values({
        userId: session.user.id,
        period: "month",
        amount: 149_00,
        externalId: operationId,
        autorenewConsentAt: new Date(Date.now() - consentAgo),
      })
      .returning();
    operations.set(operationId, { status: "APPROVED", amount: 149 });
    return call(
      billingRouter.status,
      { paymentId: payment?.id ?? "" },
      { context: api.context(session) },
    );
  }

  async function canceledSession(email: string) {
    const session = await createSession(api.db, { email });
    await api.db.insert(Subscription).values({
      userId: session.user.id,
      trialEndsAt: new Date(Date.now() + 5 * DAY),
    });
    await api.db.insert(SubscriptionAutorenewal).values({
      userId: session.user.id,
      externalId: "newer-subscription",
      period: "month",
      status: "canceled",
      cancelReason: "user",
      consentAt: new Date(Date.now() - 2 * DAY),
      canceledAt: new Date(Date.now() - DAY),
    });
    return session;
  }

  it("extends the period but does not undo a cancellation", async () => {
    tochka();
    const session = await canceledSession("late-old@test.local");

    const paid = await pendingConsent(session, "old-link-1", 3 * DAY);

    expect(paid.status).toBe("succeeded");
    expect(await paidUntilOf(session)).toBeInstanceOf(Date);
    expect(await autorenewalOf(session)).toMatchObject({
      status: "canceled",
      externalId: "newer-subscription",
    });
  });

  it("is replaced by an agreement made after the cancellation", async () => {
    tochka();
    const session = await canceledSession("late-new@test.local");

    await pendingConsent(session, "new-link-1", HOUR);

    expect(await autorenewalOf(session)).toMatchObject({
      status: "active",
      externalId: "new-link-1",
      cancelReason: null,
    });
  });
});

describe("switching auto-renewal off", () => {
  it("is done by the specialist, keeps the paid period, and is safe to repeat", async () => {
    tochka();
    const now = new Date();
    const paidUntil = new Date(now.getTime() + HOUR);
    const session = await renewing("cancel@test.local", paidUntil);
    const context = api.context(session);

    expect(
      await call(billingRouter.cancelAutorenew, undefined, { context }),
    ).toEqual({ canceled: true });
    expect(
      await call(billingRouter.cancelAutorenew, undefined, { context }),
    ).toEqual({ canceled: false });
    expect(await autorenewalOf(session)).toMatchObject({
      status: "canceled",
      cancelReason: "user",
    });
    expect(await paidUntilOf(session)).toEqual(paidUntil);
    expect(
      (await call(billingRouter.get, undefined, { context })).autorenew,
    ).toBeNull();

    await renewSubscriptions(api.db, recorder().deliver, now);
    expect(charges()).toHaveLength(0);
  });

  it("happens with a refund, which a subscription payment makes in the bank", async () => {
    tochka();
    const admin = await createSession(api.db, { email: ADMIN_EMAIL });
    const now = new Date();
    const session = await renewing(
      "refund-sub@test.local",
      new Date(now.getTime() + HOUR),
    );
    await renewSubscriptions(api.db, recorder().deliver, now);
    const [payment] = await paymentsOf(session);
    if (!payment) throw new Error("No charge");
    const context = api.context(admin);
    const end = await paidUntilOf(session);

    await expect(
      call(billingRouter.refund, { paymentId: payment.id }, { context }),
    ).rejects.toMatchObject({ code: "BANK_ONLY" });
    expect(requests.filter((r) => r.url.endsWith("/refund"))).toHaveLength(0);
    expect(await paidUntilOf(session)).toEqual(end);

    const refunded = await call(
      billingRouter.refund,
      { paymentId: payment.id, recorded: true },
      { context },
    );
    expect(refunded.refundedAt).toBeInstanceOf(Date);
    // Nothing is sent to the bank: the money went back in the internet bank.
    expect(requests.filter((r) => r.url.endsWith("/refund"))).toHaveLength(0);
    expect(await autorenewalOf(session)).toMatchObject({
      status: "canceled",
      cancelReason: "refund",
    });
    const after = await paidUntilOf(session);
    expect(after && end && after.getTime() < end.getTime()).toBe(true);
  });
});

describe("notices about the end of «Про»", () => {
  const trialEndsAt = new Date("2026-01-01T00:00:00Z");
  const paidUntil = new Date("2026-06-01T00:00:00Z");
  const plan = {
    trialEndsAt,
    paidUntil,
    lastPeriod: "month" as const,
  };
  const at = (offset: number) => new Date(paidUntil.getTime() + offset);

  it("stay quiet while a renewing period is still running", () => {
    expect(dueProNotice(plan, at(-2 * DAY))?.notice).toBe("ending");
    expect(
      dueProNotice({ ...plan, autorenew: true }, at(-2 * DAY)),
    ).toBeUndefined();
  });

  it("still tell that «Про» ended when the renewal did not happen", () => {
    expect(dueProNotice({ ...plan, autorenew: true }, at(HOUR))?.notice).toBe(
      "ended",
    );
  });
});

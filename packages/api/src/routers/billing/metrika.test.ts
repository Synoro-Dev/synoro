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
import { eq, SubscriptionPayment } from "@synoro/db";
import { conversionCsv, reportPaidYears } from "@synoro/jobs/metrika";

import { createSession, setupTestApi } from "../../../test/helpers";
import { adAttribution } from "../../lib/billing/attribution";
import { billingRouter } from ".";

const DAY = 24 * 60 * 60 * 1000;

let api: Awaited<ReturnType<typeof setupTestApi>>;
let fetchMock: Mock<typeof fetch>;
let uploads: { url: string; authorization: string | null; csv: string }[] = [];
let metrikaStatus = 200;
let nextOperation = 1;

function stubFetch() {
  fetchMock.mockImplementation((async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://api-metrika.yandex.net/")) {
      const file = (init.body as FormData).get("file") as Blob;
      uploads.push({
        url,
        authorization: new Headers(init.headers).get("authorization"),
        csv: await file.text(),
      });
      return metrikaStatus === 200
        ? Response.json({
            uploading: { id: uploads.length, status: "PREPARED" },
          })
        : new Response("nope", { status: metrikaStatus });
    }
    // Точка: opening a payment link.
    const body = JSON.parse(String(init.body));
    const operationId = `metrika-op-${nextOperation++}`;
    return Response.json({
      Data: {
        ...body.Data,
        operationId,
        status: "CREATED",
        paymentLink: `https://merch.tochka.com/order/?uuid=${operationId}`,
      },
    });
  }) as typeof fetch);
}

type PaymentValues = Partial<typeof SubscriptionPayment.$inferInsert>;

/** A paid year (by default 1 hour ago) that came from an ad click. */
async function paid(userId: string, values: PaymentValues = {}) {
  const [row] = await api.db
    .insert(SubscriptionPayment)
    .values({
      userId,
      period: "year",
      amount: 1490_00,
      status: "succeeded",
      externalId: `real-${crypto.randomUUID()}`,
      paidAt: new Date(Date.now() - 60 * 60 * 1000),
      yclid: "1234567890123456789",
      ...values,
    })
    .returning();
  if (!row) throw new Error("Failed to insert payment");
  return row;
}

async function specialist() {
  return (await createSession(api.db)).user.id;
}

beforeAll(async () => {
  api = await setupTestApi();
  fetchMock = spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchMock.mockReset();
  uploads = [];
  metrikaStatus = 200;
});
afterAll(async () => {
  fetchMock.mockRestore();
  await api.close();
});

describe("adAttribution", () => {
  it("reads the Direct click and the Metrika visitor from the cookies", () => {
    const headers = new Headers({
      cookie: "a=1; _ym_uid=1700000000123456789; ad_yclid=98765_abc-D; b=2",
    });
    expect(adAttribution(headers)).toEqual({
      yclid: "98765_abc-D",
      yclidAt: null,
      ymClientId: "1700000000123456789",
    });
  });

  it("reads when the click happened, unless that is not plausible", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const read = (at: string) =>
      adAttribution(
        new Headers({ cookie: `ad_yclid=42; ad_yclid_at=${at}` }),
        now,
      );
    expect(read("1793000000").yclidAt).toEqual(new Date(1793000000 * 1000));
    expect(read("1793620801").yclidAt).toBeNull();
    expect(read("0").yclidAt).toBeNull();
    expect(read("soon").yclidAt).toBeNull();
    // A time without a click means nothing.
    expect(
      adAttribution(new Headers({ cookie: "ad_yclid_at=1793000000" }), now),
    ).toEqual({ yclid: null, yclidAt: null, ymClientId: null });
  });

  it("ignores missing cookies and values of the wrong shape", () => {
    expect(adAttribution(new Headers())).toEqual({
      yclid: null,
      yclidAt: null,
      ymClientId: null,
    });
    const headers = new Headers({
      cookie: `ad_yclid=${"1".repeat(65)}; _ym_uid=12ab`,
    });
    expect(adAttribution(headers)).toEqual({
      yclid: null,
      yclidAt: null,
      ymClientId: null,
    });
    expect(
      adAttribution(new Headers({ cookie: "ad_yclid=a b; _ym_uid=" })),
    ).toEqual({ yclid: null, yclidAt: null, ymClientId: null });
  });
});

describe("checkout", () => {
  it("keeps where the specialist came from on the payment", async () => {
    stubFetch();
    const session = await createSession(api.db);
    const context = {
      ...api.context(session),
      headers: new Headers({
        cookie:
          "_ym_uid=1700000000123456789; ad_yclid=555111; ad_yclid_at=1793000000",
      }),
    };
    const started = await call(
      billingRouter.checkout,
      { period: "year" },
      { context },
    );
    const payment = await api.db.query.SubscriptionPayment.findFirst({
      where: eq(SubscriptionPayment.id, started.paymentId),
    });
    expect(payment).toMatchObject({
      yclid: "555111",
      yclidAt: new Date(1793000000 * 1000),
      ymClientId: "1700000000123456789",
    });
  });
});

describe("conversionCsv", () => {
  const base = {
    target: "paid_year",
    paidAt: new Date("2026-11-02T12:00:00Z"),
    amount: 1490_00,
    yclidAt: null,
  };
  const now = new Date("2026-11-02T13:00:00Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("identifies the visit by the click, else by the visitor", () => {
    expect(conversionCsv({ ...base, yclid: "42", ymClientId: "7" })).toBe(
      "Yclid,Target,DateTime,Price,Currency\n42,paid_year,1793620800,1490.00,RUB\n",
    );
    expect(conversionCsv({ ...base, yclid: null, ymClientId: "7" })).toBe(
      "ClientId,Target,DateTime,Price,Currency\n7,paid_year,1793620800,1490.00,RUB\n",
    );
  });

  it("drops a click Metrika no longer matches for the visitor", () => {
    const click = (days: number) => ({
      ...base,
      yclid: "42",
      yclidAt: new Date(now.getTime() - days * DAY_MS),
      ymClientId: "7",
    });
    expect(conversionCsv(click(20), now)).toStartWith("Yclid,");
    expect(conversionCsv(click(22), now)).toStartWith("ClientId,");
    // Nothing else to match by: the click is still the best try.
    expect(conversionCsv({ ...click(30), ymClientId: null }, now)).toStartWith(
      "Yclid,",
    );
  });

  it("refuses a conversion nobody can be matched to", () => {
    expect(() =>
      conversionCsv({ ...base, yclid: null, ymClientId: null }),
    ).toThrow();
  });
});

describe("reportPaidYears", () => {
  it("uploads the first paid year once", async () => {
    stubFetch();
    const userId = await specialist();
    await paid(userId);

    expect(await reportPaidYears(api.db)).toEqual({ sent: 1 });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      url: "https://api-metrika.yandex.net/management/v1/counter/12345678/offline_conversions/upload",
      authorization: "OAuth test-metrika-token",
    });
    expect(uploads[0]?.csv).toStartWith(
      "Yclid,Target,DateTime,Price,Currency\n1234567890123456789,paid_year,",
    );
    expect(uploads[0]?.csv).toEndWith(",1490.00,RUB\n");

    expect(await reportPaidYears(api.db)).toEqual({ sent: 0 });
    expect(uploads).toHaveLength(1);
  });

  it("falls back to the Metrika visitor without a click", async () => {
    stubFetch();
    const userId = await specialist();
    await paid(userId, { yclid: null, ymClientId: "1700000000123456789" });

    await reportPaidYears(api.db);
    expect(uploads[0]?.csv).toStartWith(
      "ClientId,Target,DateTime,Price,Currency\n1700000000123456789,",
    );
  });

  it("skips what is not a new annual customer", async () => {
    stubFetch();
    const buyer = await specialist();
    const first = await paid(buyer, {
      paidAt: new Date(Date.now() - 3 * DAY),
    });
    // The user's next year is a renewal, not a new customer.
    await paid(buyer, { paidAt: new Date(Date.now() - 2 * DAY) });
    await reportPaidYears(api.db);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.csv).toContain(`${first.yclid},paid_year`);

    const skipped: PaymentValues[] = [
      { period: "month", amount: 149_00 },
      { yclid: null, ymClientId: null },
      { refundedAt: new Date() },
      { chargedFor: new Date() },
      { status: "pending" },
      { externalId: "demo-1" },
      { externalId: "sandbox-1" },
      { paidAt: new Date(Date.now() - 15 * DAY) },
    ];
    for (const values of skipped) await paid(await specialist(), values);
    uploads = [];
    expect(await reportPaidYears(api.db)).toEqual({ sent: 0 });
    expect(uploads).toHaveLength(0);
  });

  it("counts a year bought after a refunded one", async () => {
    stubFetch();
    const userId = await specialist();
    await paid(userId, {
      paidAt: new Date(Date.now() - 5 * DAY),
      refundedAt: new Date(Date.now() - 4 * DAY),
      yclid: "refunded-click",
    });
    await paid(userId, { yclid: "second-click" });

    await reportPaidYears(api.db);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.csv).toContain("second-click");
  });

  it("does not let the sent ones crowd out the later payments", async () => {
    stubFetch();
    const buyers = await Promise.all(Array.from({ length: 55 }, specialist));
    for (const [index, userId] of buyers.entries()) {
      await paid(userId, { yclid: `batch-${index}` });
    }

    expect(await reportPaidYears(api.db)).toEqual({ sent: 50 });
    expect(await reportPaidYears(api.db)).toEqual({ sent: 5 });
    expect(await reportPaidYears(api.db)).toEqual({ sent: 0 });
    expect(uploads).toHaveLength(55);
  });

  it("tries again after a failed upload", async () => {
    stubFetch();
    const userId = await specialist();
    await paid(userId);

    metrikaStatus = 500;
    expect(await reportPaidYears(api.db)).toEqual({ sent: 0 });
    expect(uploads).toHaveLength(1);

    metrikaStatus = 200;
    expect(await reportPaidYears(api.db)).toEqual({ sent: 1 });
    expect(uploads).toHaveLength(2);
  });
});

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
  Booking,
  BookingSeries,
  CreditEntry,
  eq,
  Payment,
  PracticeMember,
  user,
} from "@synoro/db";
import { collectAccount } from "@synoro/jobs/data-export";
import { createSession, setupTestApi } from "../../../test/helpers";

import { hashGuestToken } from "../../lib/guests";
import { handlePaymentWebhook } from "../../lib/payments";
import { availabilityRouter } from "../availability";
import { paymentRouter } from "../payment";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;
let fetchMock: Mock<typeof fetch>;

/** Mondays, 10:00–13:00 MSK: 07:00Z, 08:00Z and 09:00Z are bookable. */
const monday = (week: number, utc = "07:00") =>
  new Date(Date.parse(`2030-01-07T${utc}:00Z`) + week * 7 * 86_400_000);

const visitor = (email: string) => ({
  name: "Иван Петров",
  phone: "8 (900) 123-45-67",
  email,
});

type Remote = { id?: string; status: string };

/** Answers every provider call with `body`. */
function provider(body: (url: string) => unknown) {
  fetchMock.mockImplementation((async (input: RequestInfo | URL) =>
    Response.json(body(String(input)))) as typeof fetch);
}

/** The provider accepts a new payment and gives it this id. */
function acceptsPayment(id: string) {
  provider(() => ({
    id,
    status: "pending",
    confirmation: {
      type: "redirect",
      confirmation_url: `https://yoomoney.ru/checkout/${id}`,
    },
  }));
}

function remoteStatus(remote: Remote) {
  provider(() => remote);
}

async function packageId(credits: number) {
  const offer = await call(
    paymentRouter.packages,
    { practiceId },
    { context: api.context() },
  );
  const pkg = offer.packages.find((p) => p.credits === credits);
  if (!pkg) throw new Error(`No package of ${credits}`);
  return pkg.id;
}

async function reserveSeries(
  week: number,
  email: string,
  options: {
    count?: number;
    packageCredits?: number;
    skip?: Date[];
    intervalWeeks?: 1 | 2;
  } = {},
) {
  return call(
    bookingRouter.reserveSeries,
    {
      practiceId,
      packageId: await packageId(options.packageCredits ?? 5),
      startsAt: monday(week),
      intervalWeeks: options.intervalWeeks ?? 1,
      count: options.count ?? 4,
      skip: options.skip ?? [],
      ...visitor(email),
    },
    { context: api.context() },
  );
}

const guest = (token: string) =>
  call(bookingRouter.guest, { token }, { context: api.context() });

async function memberOf(email: string) {
  const [row] = await api.db
    .select({ id: PracticeMember.id, credits: PracticeMember.credits })
    .from(PracticeMember)
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(eq(user.email, email));
  return row;
}

const seriesBookings = async (token: string) => {
  const first = await api.db.query.Booking.findFirst({
    where: eq(Booking.accessTokenHash, hashGuestToken(token)),
  });
  if (!first?.seriesId) return [];
  return api.db.query.Booking.findMany({
    where: eq(Booking.seriesId, first.seriesId),
    orderBy: (b, { asc }) => asc(b.startsAt),
  });
};

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    {
      name: "Анна Иванова",
      slug: "anna-guest-series",
      profession: "psychologist",
    },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );

  fetchMock = spyOn(globalThis, "fetch");
  provider(() => ({ account_id: "123456", test: true }));
  await call(
    paymentRouter.connect,
    {
      practiceId,
      provider: "yookassa",
      merchantId: "123456",
      secret: "test_secret",
      receipts: false,
      taxSystem: null,
    },
    { context: api.context(owner) },
  );
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
});
afterEach(() => fetchMock.mockReset());
afterAll(async () => {
  fetchMock.mockRestore();
  if (api) await api.close();
});

describe("guestSeriesPreview", () => {
  it("lists the dates for a visitor and what one booking costs", async () => {
    const preview = await call(
      bookingRouter.guestSeriesPreview,
      { practiceId, startsAt: monday(5), intervalWeeks: 1, count: 3 },
      { context: api.context() },
    );
    expect(preview.price).toBe(1);
    expect(preview.dates.map((d) => d.status)).toEqual([
      "free",
      "free",
      "free",
    ]);
  });
});

describe("booking a series as a visitor", () => {
  it("holds every date under one payment, then confirms them all at once", async () => {
    acceptsPayment("s-1");
    const email = "series@visitor.test";
    const { token, dates } = await reserveSeries(10, email);
    expect(dates).toHaveLength(4);

    // Four held bookings with one deadline; the link opens the first only.
    const held = await seriesBookings(token);
    expect(held).toHaveLength(4);
    expect(new Set(held.map((b) => b.holdUntil?.getTime())).size).toBe(1);
    expect(held[0]?.accessTokenHash).toBe(hashGuestToken(token));
    expect(held.slice(1).every((b) => b.accessTokenHash === null)).toBe(true);
    const series = await api.db.query.BookingSeries.findFirst({
      where: eq(BookingSeries.id, held[0]?.seriesId ?? ""),
    });
    expect(series).toMatchObject({ count: 4, intervalWeeks: 1 });
    const payment = await api.db.query.Payment.findFirst({
      where: eq(Payment.seriesId, series?.id ?? ""),
    });
    expect(payment).toMatchObject({ credits: 5, status: "pending" });
    expect(payment?.bookingId).toBe(held[0]?.id ?? "");

    remoteStatus({ id: "s-1", status: "pending" });
    expect(await guest(token)).toMatchObject({
      state: "awaiting_payment",
      payUrl: "https://yoomoney.ru/checkout/s-1",
    });
    expect((await guest(token)).seriesDates).toHaveLength(4);
    expect((await memberOf(email))?.credits).toBe(0);

    // Back from the payment form: every date is confirmed, one credit each.
    remoteStatus({ id: "s-1", status: "succeeded" });
    expect(await guest(token)).toMatchObject({
      state: "confirmed",
      balance: 1,
    });
    const confirmed = await seriesBookings(token);
    expect(
      confirmed.every((b) => b.status === "active" && b.holdUntil === null),
    ).toBe(true);
    const member = await memberOf(email);
    expect(member?.credits).toBe(1);

    // The webhook arriving afterwards changes nothing.
    const response = await handlePaymentWebhook(
      "yookassa",
      new Request("http://localhost/api/payments/yookassa", {
        method: "POST",
        body: JSON.stringify({ object: { id: "s-1", status: "succeeded" } }),
      }),
      api.db,
    );
    expect(response.status).toBe(200);
    expect((await memberOf(email))?.credits).toBe(1);

    const entries = await api.db.query.CreditEntry.findMany({
      where: eq(CreditEntry.memberId, member?.id ?? ""),
    });
    expect(entries.map((e) => [e.reason, e.delta]).sort()).toEqual([
      ["booking", -1],
      ["booking", -1],
      ["booking", -1],
      ["booking", -1],
      ["purchase", 5],
    ]);
    // Each booking entry belongs to its own booking.
    expect(
      new Set(
        entries.filter((e) => e.reason === "booking").map((e) => e.bookingId),
      ).size,
    ).toBe(4);
  });

  it("needs a package that covers every date, and books nothing otherwise", async () => {
    acceptsPayment("s-2");
    await expect(
      reserveSeries(20, "small@visitor.test", { packageCredits: 1 }),
    ).rejects.toMatchObject({ code: "PACKAGE_TOO_SMALL" });
    expect(await memberOf("small@visitor.test")).toBeUndefined();
    expect(
      await api.db.query.Booking.findMany({
        where: eq(Booking.startsAt, monday(20)),
      }),
    ).toEqual([]);
  });

  it("names the dates that are taken, and books around skipped ones", async () => {
    acceptsPayment("s-3");
    // Week 31 is taken by a single visitor booking.
    await call(
      bookingRouter.reserve,
      {
        practiceId,
        packageId: await packageId(1),
        startsAt: monday(31),
        ...visitor("single@visitor.test"),
      },
      { context: api.context() },
    );

    const error = await reserveSeries(30, "around@visitor.test", {
      count: 3,
    }).catch((e) => e);
    expect(error).toMatchObject({
      code: "SLOT_UNAVAILABLE",
      data: { dates: [monday(31)] },
    });
    expect(await memberOf("around@visitor.test")).toBeUndefined();

    acceptsPayment("s-4");
    const { token, dates } = await reserveSeries(30, "around@visitor.test", {
      count: 3,
      skip: [monday(31)],
    });
    expect(dates).toEqual([monday(30), monday(32)]);
    expect(await seriesBookings(token)).toHaveLength(2);
    const series = await api.db.query.BookingSeries.findFirst({
      where: eq(
        BookingSeries.id,
        (await seriesBookings(token))[0]?.seriesId ?? "",
      ),
    });
    expect(series?.count).toBe(2);
  });

  it("releases every date when the payment is declined", async () => {
    acceptsPayment("s-5");
    const { token } = await reserveSeries(40, "declined-series@visitor.test");

    remoteStatus({ id: "s-5", status: "canceled" });
    expect(await guest(token)).toMatchObject({ state: "expired" });
    const after = await seriesBookings(token);
    expect(after).toHaveLength(4);
    expect(
      after.every(
        (b) =>
          b.status === "cancelled" && b.cancelReason === "payment_cancelled",
      ),
    ).toBe(true);
    expect((await memberOf("declined-series@visitor.test"))?.credits).toBe(0);

    // The time is free again for the next visitor.
    acceptsPayment("s-6");
    await reserveSeries(40, "next-series@visitor.test");
  });

  it("puts late money on the balance when the hold ran out", async () => {
    acceptsPayment("s-7");
    const email = "late-series@visitor.test";
    const { token } = await reserveSeries(50, email);
    const held = await seriesBookings(token);
    await api.db
      .update(Booking)
      .set({ holdUntil: new Date(Date.now() - 1000) })
      .where(eq(Booking.seriesId, held[0]?.seriesId ?? ""));

    // Someone else books the freed time: the hold was released with the call.
    acceptsPayment("s-8");
    await reserveSeries(50, "taker@visitor.test");
    expect((await seriesBookings(token)).map((b) => b.cancelReason)).toEqual([
      "hold_expired",
      "hold_expired",
      "hold_expired",
      "hold_expired",
    ]);

    remoteStatus({ id: "s-7", status: "succeeded" });
    expect(await guest(token)).toMatchObject({
      state: "cancelled",
      balance: 5,
    });
    expect((await memberOf(email))?.credits).toBe(5);
  });

  it("counts a series as one open hold", async () => {
    acceptsPayment("s-9");
    const email = "holds-series@visitor.test";
    await reserveSeries(60, email);
    // One series and one single time: two holds, a third is refused.
    acceptsPayment("s-9b");
    await call(
      bookingRouter.reserve,
      {
        practiceId,
        packageId: await packageId(1),
        startsAt: monday(70),
        ...visitor(email),
      },
      { context: api.context() },
    );
    await expect(
      call(
        bookingRouter.reserve,
        {
          practiceId,
          packageId: await packageId(1),
          startsAt: monday(71),
          ...visitor(email),
        },
        { context: api.context() },
      ),
    ).rejects.toMatchObject({ code: "TOO_MANY_HOLDS" });
  });

  it("refuses a series with fewer than two dates left", async () => {
    acceptsPayment("s-10");
    await expect(
      reserveSeries(80, "few@visitor.test", {
        count: 2,
        skip: [monday(81)],
      }),
    ).rejects.toMatchObject({ code: "TOO_FEW" });
  });
});

describe("review fixes", () => {
  it("keeps a series unconfirmed when its hold ran out before the payment", async () => {
    acceptsPayment("s-11");
    const email = "expired-first@visitor.test";
    const { token } = await reserveSeries(120, email);
    const held = await seriesBookings(token);
    // The hold ran out, but nothing has released it yet.
    await api.db
      .update(Booking)
      .set({ holdUntil: new Date(Date.now() - 1000) })
      .where(eq(Booking.seriesId, held[0]?.seriesId ?? ""));

    remoteStatus({ id: "s-11", status: "succeeded" });
    await guest(token);
    expect((await memberOf(email))?.credits).toBe(5);
    const after = await seriesBookings(token);
    expect(after.every((b) => b.holdUntil !== null)).toBe(true);
    // No booking was charged for.
    const entries = await api.db.query.CreditEntry.findMany({
      where: eq(CreditEntry.memberId, (await memberOf(email))?.id ?? ""),
    });
    expect(entries.map((e) => e.reason)).toEqual(["purchase"]);
  });

  it("lets only one of two parallel reservations take the last hold", async () => {
    const email = "parallel@visitor.test";
    acceptsPayment("s-12");
    await reserveSeries(130, email);
    // One hold is open; two requests race for the second, then no more.
    provider(() => ({
      id: `s-par-${crypto.randomUUID()}`,
      status: "pending",
      confirmation: {
        type: "redirect",
        confirmation_url: "https://yoomoney.ru/checkout/par",
      },
    }));
    const attempt = async (week: number) =>
      call(
        bookingRouter.reserveSeries,
        {
          practiceId,
          packageId: await packageId(5),
          startsAt: monday(week),
          intervalWeeks: 1,
          count: 2,
          skip: [],
          ...visitor(email),
        },
        { context: api.context() },
      );
    const results = await Promise.allSettled([attempt(140), attempt(150)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected");
    expect(refused).toMatchObject({
      reason: { code: "TOO_MANY_HOLDS" },
    });
  });

  it("names the series in a payment of the export", async () => {
    acceptsPayment("s-13");
    const { token } = await reserveSeries(160, "export@visitor.test");
    const held = await seriesBookings(token);
    const dump = await collectAccount(api.db, owner.user.id);
    const payment = dump.practices[0]?.payments.find(
      (p) => p.series_id === held[0]?.seriesId,
    );
    expect(payment).toMatchObject({ booking_id: held[0]?.id });
  });
});

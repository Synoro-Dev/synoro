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
  CreditEntry,
  eq,
  Payment,
  PracticeMember,
  user,
} from "@synoro/db";

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

function reserve(
  week: number,
  email: string,
  options: { utc?: string; packageCredits?: number } = {},
) {
  return packageId(options.packageCredits ?? 5).then((id) =>
    call(
      bookingRouter.reserve,
      {
        practiceId,
        packageId: id,
        startsAt: monday(week, options.utc),
        ...visitor(email),
      },
      { context: api.context() },
    ),
  );
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

const guest = (token: string) =>
  call(bookingRouter.guest, { token }, { context: api.context() });

async function balanceOf(email: string) {
  const [row] = await api.db
    .select({ credits: PracticeMember.credits })
    .from(PracticeMember)
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(eq(user.email, email));
  return row?.credits;
}

async function cancelReasonOf(token: string) {
  const row = await api.db.query.Booking.findFirst({
    where: eq(Booking.accessTokenHash, hashGuestToken(token)),
    columns: { cancelReason: true },
  });
  return row?.cancelReason;
}

async function slotsOn(week: number) {
  const day = monday(week).toISOString().slice(0, 10);
  const { slots } = await call(
    bookingRouter.slots,
    { practiceId, from: day, days: 1 },
    { context: api.context() },
  );
  return slots.map((s) => s.startsAt.toISOString().slice(11, 16));
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-guest", profession: "psychologist" },
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

describe("booking as a visitor", () => {
  it("holds the time, then confirms it once the payment succeeds", async () => {
    acceptsPayment("g-1");
    const email = "ivan@visitor.test";
    const { token, confirmationUrl } = await reserve(0, email);
    expect(confirmationUrl).toBe("https://yoomoney.ru/checkout/g-1");

    // A passive account with the phone, a client membership, a held booking.
    const account = await api.db.query.user.findFirst({
      where: eq(user.email, email),
    });
    expect(account).toMatchObject({
      emailVerified: false,
      phone: "+79001234567",
      name: "Иван Петров",
    });
    const booking = await api.db.query.Booking.findFirst({
      where: eq(Booking.createdById, account?.id ?? ""),
    });
    expect(booking?.holdUntil).toBeInstanceOf(Date);
    expect(booking?.accessTokenHash).not.toBe(token);
    expect(booking?.guestPhone).toBe("+79001234567");

    // The held hour is gone from the page, the visitor sees the wait.
    expect(await slotsOn(0)).toEqual(["08:00", "09:00"]);
    remoteStatus({ id: "g-1", status: "pending" });
    expect(await guest(token)).toMatchObject({
      state: "awaiting_payment",
      payUrl: "https://yoomoney.ru/checkout/g-1",
      email: "i***@visitor.test",
      // The video room is for confirmed bookings only.
      videoUrl: null,
    });
    expect(await balanceOf(email)).toBe(0);
    await call(
      practiceRouter.setVideoUrl,
      { practiceId, videoUrl: "https://acme.ktalk.ru/anna" },
      { context: api.context(owner) },
    );

    // Back from the payment form: the status check settles it.
    remoteStatus({ id: "g-1", status: "succeeded" });
    expect(await guest(token)).toMatchObject({
      state: "confirmed",
      balance: 4,
      canCancel: true,
      videoUrl: "https://acme.ktalk.ru/anna",
    });
    expect(await balanceOf(email)).toBe(4);

    // The webhook arriving afterwards changes nothing.
    const response = await handlePaymentWebhook(
      "yookassa",
      new Request("http://localhost/api/payments/yookassa", {
        method: "POST",
        body: JSON.stringify({ object: { id: "g-1", status: "succeeded" } }),
      }),
      api.db,
    );
    expect(response.status).toBe(200);
    expect(await balanceOf(email)).toBe(4);

    const memberId = (
      await api.db.query.PracticeMember.findFirst({
        where: eq(PracticeMember.userId, account?.id ?? ""),
      })
    )?.id;
    const entries = await api.db.query.CreditEntry.findMany({
      where: eq(CreditEntry.memberId, memberId ?? ""),
    });
    expect(entries.map((e) => [e.reason, e.delta]).sort()).toEqual([
      ["booking", -1],
      ["purchase", 5],
    ]);
  });

  it("refuses a second visitor for a held or booked time", async () => {
    acceptsPayment("g-2");
    await expect(
      reserve(0, "other@visitor.test", { utc: "07:00" }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    // Nothing was left behind for the failed attempt.
    expect(
      await api.db.query.Payment.findMany({
        where: eq(Payment.externalId, "g-2"),
      }),
    ).toEqual([]);
  });

  it("requires a phone and refuses staff addresses", async () => {
    await expect(
      call(
        bookingRouter.reserve,
        {
          practiceId,
          packageId: await packageId(1),
          startsAt: monday(1),
          name: "Иван",
          phone: "",
          email: "nophone@visitor.test",
        },
        { context: api.context() },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      call(
        bookingRouter.reserve,
        {
          practiceId,
          packageId: await packageId(1),
          startsAt: monday(1),
          ...visitor(owner.user.email.toUpperCase()),
        },
        { context: api.context() },
      ),
    ).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
  });

  it("frees the time when the payment is declined", async () => {
    acceptsPayment("g-3");
    const { token } = await reserve(2, "declined@visitor.test");
    expect(await slotsOn(2)).toEqual(["08:00", "09:00"]);

    remoteStatus({ id: "g-3", status: "canceled" });
    expect(await guest(token)).toMatchObject({ state: "expired" });
    expect(await cancelReasonOf(token)).toBe("payment_cancelled");
    expect(await slotsOn(2)).toEqual(["07:00", "08:00", "09:00"]);
    expect(await balanceOf("declined@visitor.test")).toBe(0);
  });

  it("releases an unpaid hold after 15 minutes; late money tops up the balance", async () => {
    acceptsPayment("g-4");
    const email = "late@visitor.test";
    const { token } = await reserve(3, email);
    await api.db
      .update(Booking)
      .set({ holdUntil: new Date(Date.now() - 1000) })
      .where(eq(Booking.status, "active"));

    // The expired hold no longer blocks the time, even before any cleanup.
    expect(await slotsOn(3)).toEqual(["07:00", "08:00", "09:00"]);
    acceptsPayment("g-5");
    const taken = await reserve(3, "next@visitor.test");
    expect(await cancelReasonOf(token)).toBe("hold_expired");

    // The first visitor pays after all: nothing to confirm, credits on balance.
    remoteStatus({ id: "g-4", status: "succeeded" });
    expect(await guest(token)).toMatchObject({
      state: "cancelled",
      balance: 5,
    });
    expect(await balanceOf(email)).toBe(5);
    expect(await slotsOn(3)).toEqual(["08:00", "09:00"]);
    expect(taken.token).not.toBe(token);
  });

  it("limits unpaid holds per visitor", async () => {
    const email = "greedy@visitor.test";
    acceptsPayment("g-6a");
    await reserve(4, email, { utc: "07:00" });
    acceptsPayment("g-6b");
    await reserve(4, email, { utc: "08:00" });
    acceptsPayment("g-6c");
    await expect(reserve(4, email, { utc: "09:00" })).rejects.toMatchObject({
      code: "TOO_MANY_HOLDS",
    });
  });

  it("lets the visitor cancel a paid booking and keeps the consultation", async () => {
    acceptsPayment("g-7");
    const email = "cancel@visitor.test";
    const { token } = await reserve(5, email, { packageCredits: 1 });
    remoteStatus({ id: "g-7", status: "succeeded" });
    expect(await guest(token)).toMatchObject({
      state: "confirmed",
      balance: 0,
    });

    const result = await call(
      bookingRouter.cancelGuest,
      { token },
      { context: api.context() },
    );
    expect(result).toEqual({ refunded: true });
    expect(await cancelReasonOf(token)).toBe("client");
    expect(await guest(token)).toMatchObject({
      state: "cancelled",
      balance: 1,
    });
    expect(await balanceOf(email)).toBe(1);
    await expect(
      call(bookingRouter.cancelGuest, { token }, { context: api.context() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not open someone else's booking with a wrong token", async () => {
    await expect(guest("x".repeat(32))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

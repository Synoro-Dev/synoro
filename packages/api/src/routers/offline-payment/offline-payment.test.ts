import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq, OfflinePayment, PracticeMember } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { analyticsRouter } from "../analytics";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { offlinePaymentRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let admin: Session;
let client: Session;
let practiceId: string;
let memberId: string;

const HOUR = 60 * 60 * 1000;

/** A booking `hours` from now (negative: in the past). */
async function bookingAt(hours: number, credits = 0) {
  const startsAt = new Date(Date.now() + hours * HOUR);
  const [row] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      credits,
      memberId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
    })
    .returning({ id: Booking.id });
  return row?.id ?? "";
}

const record = (
  session: Session,
  input: { bookingId?: string; memberId?: string; amount?: number },
) =>
  call(
    offlinePaymentRouter.record,
    {
      practiceId,
      amount: 300_000,
      method: "cash",
      paidAt: new Date(),
      ...input,
    },
    { context: api.context(session) },
  );

const unpaidIds = async () =>
  (
    await call(
      offlinePaymentRouter.unpaid,
      { practiceId },
      { context: api.context(owner) },
    )
  ).map((b) => b.id);

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  admin = await createSession(api.db, { name: "Мария" });
  client = await createSession(api.db, { name: "Борис" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-offline", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  await api.db
    .insert(PracticeMember)
    .values({ practiceId, userId: admin.user.id, role: "admin" });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(client) },
  );
  memberId = member.id;
});

afterAll(async () => {
  await api.close();
});

describe("offline payments", () => {
  it("lists past bookings paid at the visit until one is marked paid", async () => {
    const past = await bookingAt(-26);
    const future = await bookingAt(30);
    const charged = await bookingAt(-50, 1);

    const before = await unpaidIds();
    expect(before).toContain(past);
    expect(before).not.toContain(future);
    expect(before).not.toContain(charged);

    await record(admin, { bookingId: past });
    expect(await unpaidIds()).not.toContain(past);

    await expect(record(owner, { bookingId: past })).rejects.toMatchObject({
      code: "ALREADY_PAID",
    });

    const stored = await api.db.query.OfflinePayment.findFirst({
      where: eq(OfflinePayment.bookingId, past),
    });
    expect(stored).toMatchObject({ memberId, amount: 300_000, method: "cash" });
  });

  it("won't take a booking paid from the balance", async () => {
    const charged = await bookingAt(-98, 1);
    await expect(record(owner, { bookingId: charged })).rejects.toMatchObject({
      code: "PREPAID",
    });
  });

  it("keeps a booking that began before the 90 days but ended within them", async () => {
    const edge = await bookingAt(-90 * 24 - 0.5);
    const gone = await bookingAt(-91 * 24);
    const ids = await unpaidIds();
    expect(ids).toContain(edge);
    expect(ids).not.toContain(gone);
  });

  it("is staff only and stays within the practice", async () => {
    await expect(record(client, { memberId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      record(owner, { memberId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        offlinePaymentRouter.record,
        {
          practiceId,
          amount: 100,
          method: "cash",
          paidAt: new Date(),
        },
        { context: api.context(owner) },
      ),
    ).rejects.toThrow();
  });

  it("records a package paid by hand together with its credits", async () => {
    const result = await call(
      creditRouter.grant,
      {
        practiceId,
        memberId,
        delta: 5,
        note: "Пакет из 5",
        payment: {
          amount: 1_400_000,
          method: "transfer",
          paidAt: new Date(),
        },
      },
      { context: api.context(owner) },
    );
    expect(result.credits).toBe(5);

    const list = await call(
      offlinePaymentRouter.list,
      { practiceId },
      { context: api.context(admin) },
    );
    const package_ = list.payments.find((p) => p.amount === 1_400_000);
    expect(package_).toMatchObject({ credits: 5, clientName: "Борис" });
    expect(list.month).toMatchObject({ amount: 1_700_000, count: 2 });

    await expect(
      call(
        creditRouter.grant,
        {
          practiceId,
          memberId,
          delta: -1,
          payment: { amount: 100, method: "cash", paidAt: new Date() },
        },
        { context: api.context(owner) },
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WITHOUT_GRANT" });
  });

  it("puts a removed booking payment back into the unpaid list", async () => {
    const booking = await bookingAt(-74);
    const { id } = await record(owner, { bookingId: booking });
    await call(
      offlinePaymentRouter.remove,
      { practiceId, paymentId: id },
      { context: api.context(owner) },
    );
    expect(await unpaidIds()).toContain(booking);
  });

  it("counts them in the practice's income", async () => {
    const { report } = await call(
      analyticsRouter.overview,
      { practiceId, days: 30 },
      { context: api.context(owner) },
    );
    // Without «Про» there is no report; the trial gives one to a new practice.
    if (!report) throw new Error("Expected a report on the trial");
    expect(report.stats).toMatchObject({
      offlineRevenue: 1_700_000,
      onlineRevenue: 0,
      revenue: 1_700_000,
      payments: 2,
    });
  });
});

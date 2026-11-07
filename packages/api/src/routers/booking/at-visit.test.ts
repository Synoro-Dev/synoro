import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, CreditEntry, eq, PracticeMember, user } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import { notifyBookingConfirmed } from "@synoro/jobs/booking-video";

import { createSession, setupTestApi } from "../../../test/helpers";
import { hashGuestToken } from "../../lib/guests";
import { availabilityRouter } from "../availability";
import { creditRouter } from "../credit";
import { paymentRouter } from "../payment";
import { practiceRouter } from "../practice";
import { serviceRouter } from "../service";
import { bookingRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;
/** The hour, then the long visit (90 minutes, two credits when paid). */
let hourId: string;
let longId: string;

// Mondays; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const MONDAY = "2030-01-07";
const at = (utc: string, day = MONDAY) => new Date(`${day}T${utc}:00Z`);

const visitor = (email: string, phone = "+7 900 555-10-01") => ({
  name: "Мария Петрова",
  phone,
  email,
});

function bookAtVisit(
  startsAt: Date,
  options: {
    guest?: ReturnType<typeof visitor>;
    session?: Session;
    serviceId?: string;
    ip?: string;
  } = {},
) {
  return call(
    bookingRouter.bookAtVisit,
    {
      practiceId,
      startsAt,
      serviceId: options.serviceId,
      guest: options.guest,
    },
    {
      context: api.context(
        options.session ?? null,
        options.ip ? { "x-forwarded-for": options.ip } : {},
      ),
    },
  );
}

function setPayAtVisit(enabled: boolean, session = owner) {
  return call(
    practiceRouter.setPayAtVisit,
    { practiceId, enabled },
    { context: api.context(session) },
  );
}

async function bookingByToken(token: string) {
  const booking = await api.db.query.Booking.findFirst({
    where: eq(Booking.accessTokenHash, hashGuestToken(token)),
  });
  if (!booking) throw new Error("booking not found");
  return booking;
}

async function joinAsClient(phone: string) {
  const session = await createSession(api.db, { phone });
  await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  const member = await api.db.query.PracticeMember.findFirst({
    where: eq(PracticeMember.userId, session.user.id),
  });
  if (!member) throw new Error("member not found");
  return { session, member };
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Ольга" });
  const practice = await call(
    practiceRouter.create,
    { name: "Ольга Белова", slug: "olga-visit", profession: "health" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  // Monday 10:00–18:00 MSK.
  await call(
    availabilityRouter.replace,
    {
      practiceId,
      rules: [{ weekday: 1, startMinute: 600, endMinute: 1080 }],
    },
    { context: api.context(owner) },
  );
  const { services } = await call(
    serviceRouter.save,
    {
      practiceId,
      services: [
        { name: "Приём", minutes: 60, credits: 1, active: true },
        { name: "Долгий приём", minutes: 90, credits: 2, active: true },
      ],
    },
    { context: api.context(owner) },
  );
  const [hour, long] = services;
  if (!hour || !long) throw new Error("services not saved");
  hourId = hour.id;
  longId = long.id;
});
afterAll(async () => {
  if (api) await api.close();
});

describe("payment at the visit: the switch", () => {
  it("is off until the owner turns it on, and only the owner can", async () => {
    await expect(
      bookAtVisit(at("07:00"), { guest: visitor("off@visit.test") }),
    ).rejects.toMatchObject({ code: "PAY_AT_VISIT_OFF" });

    const { session: client } = await joinAsClient("+79005551000");
    await expect(setPayAtVisit(true, client)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(await setPayAtVisit(true)).toEqual({ enabled: true });
    const page = await call(
      practiceRouter.bySlug,
      { slug: "olga-visit" },
      { context: api.context() },
    );
    expect(page.payAtVisit).toBe(true);
  });

  it("closes online payment", async () => {
    const offer = await call(
      bookingRouter.reserve,
      {
        practiceId,
        packageId: crypto.randomUUID(),
        startsAt: at("07:00"),
        ...visitor("pay@visit.test"),
      },
      { context: api.context() },
    ).catch((error: unknown) => error);
    expect(offer).toMatchObject({ code: "PAYMENTS_DISABLED" });
    const packages = await call(
      paymentRouter.packages,
      { practiceId },
      { context: api.context() },
    );
    expect(packages.enabled).toBe(false);
  });
});

describe("a visitor books a service", () => {
  it("is confirmed at once for the service's length, nothing taken", async () => {
    const email = "maria@visit.test";
    const { token, startsAt, endsAt } = await bookAtVisit(at("07:00"), {
      guest: visitor(email),
      serviceId: longId,
    });
    expect(startsAt).toEqual(at("07:00"));
    expect(endsAt).toEqual(at("08:30"));

    const booking = await bookingByToken(token);
    expect(booking).toMatchObject({
      kind: "consultation",
      serviceId: longId,
      credits: 0,
      status: "active",
      holdUntil: null,
      guestName: "Мария Петрова",
      guestPhone: "+79005551001",
    });
    const account = await api.db.query.user.findFirst({
      where: eq(user.email, email),
    });
    const member = await api.db.query.PracticeMember.findFirst({
      where: eq(PracticeMember.userId, account?.id ?? ""),
    });
    expect(member).toMatchObject({ role: "client", credits: 0 });
    expect(booking.memberId).toBe(member?.id ?? "");

    const page = await call(
      bookingRouter.guest,
      { token },
      { context: api.context() },
    );
    expect(page).toMatchObject({
      state: "confirmed",
      kind: "consultation",
      charged: false,
      canCancel: true,
    });
  });

  it("allows three upcoming bookings per person, by account or phone", async () => {
    const phone = "+7 900 555-10-02";
    await bookAtVisit(at("09:00"), { guest: visitor("a@visit.test", phone) });
    await bookAtVisit(at("10:00"), { guest: visitor("a@visit.test", phone) });
    // Another email, the same phone: the same person.
    const third = await bookAtVisit(at("11:00"), {
      guest: visitor("b@visit.test", phone),
    });
    await expect(
      bookAtVisit(at("12:00"), { guest: visitor("c@visit.test", phone) }),
    ).rejects.toMatchObject({ code: "TOO_MANY" });

    // A cancelled one frees a place.
    await call(
      bookingRouter.cancelGuest,
      { token: third.token },
      { context: api.context() },
    );
    await bookAtVisit(at("12:00"), { guest: visitor("c@visit.test", phone) });
  });

  it("refuses taken times, unknown services and missing contacts", async () => {
    const guest = visitor("slots@visit.test", "+79005551003");
    await expect(bookAtVisit(at("08:00"), { guest })).rejects.toMatchObject({
      code: "SLOT_UNAVAILABLE",
    });
    await expect(
      bookAtVisit(at("13:00"), { guest, serviceId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
    await expect(bookAtVisit(at("13:00"))).rejects.toMatchObject({
      code: "CONTACTS_REQUIRED",
    });
  });

  it("is cancelled by the link until it starts, and says cancelled", async () => {
    const { token } = await bookAtVisit(at("07:00", "2030-01-14"), {
      guest: visitor("soon@visit.test", "+79005551004"),
      serviceId: hourId,
    });
    const booking = await bookingByToken(token);
    // As if it started in an hour: past the 24 hours of a paid booking.
    const soon = Date.now() + 60 * 60 * 1000;
    await api.db
      .update(Booking)
      .set({ startsAt: new Date(soon), endsAt: new Date(soon + 3_600_000) })
      .where(eq(Booking.id, booking.id));

    const result = await call(
      bookingRouter.cancelGuest,
      { token },
      { context: api.context() },
    );
    expect(result).toEqual({ refunded: false });
    const page = await call(
      bookingRouter.guest,
      { token },
      { context: api.context() },
    );
    expect(page.state).toBe("cancelled");
  });

  it("limits requests from one address", async () => {
    const guest = visitor("flood@visit.test", "+79005551005");
    // Off the schedule: each one fails, and each one counts.
    for (let i = 0; i < 10; i++) {
      await expect(
        bookAtVisit(at("06:00", "2030-01-21"), { guest, ip: "203.0.113.7" }),
      ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    }
    await expect(
      bookAtVisit(at("06:00", "2030-01-21"), { guest, ip: "203.0.113.7" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("a signed-in client", () => {
  it("books here, not from the balance, and cancels from the cabinet", async () => {
    const { session } = await joinAsClient("+79005551006");
    await expect(
      call(
        bookingRouter.book,
        { practiceId, startsAt: at("13:00") },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "PAY_AT_VISIT" });

    await bookAtVisit(at("13:00"), { session, serviceId: hourId });
    const mine = await call(bookingRouter.mine, undefined, {
      context: api.context(session),
    });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: "consultation",
      charged: false,
      canCancel: true,
    });

    const cancelled = await call(
      bookingRouter.cancel,
      { bookingId: mine[0]?.id ?? "" },
      { context: api.context(session) },
    );
    expect(cancelled.refunded).toBe(false);

    const noPhone = await createSession(api.db, { phone: null });
    await expect(
      bookAtVisit(at("13:00"), { session: noPhone }),
    ).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    await expect(
      bookAtVisit(at("13:00"), { session: owner }),
    ).rejects.toMatchObject({ code: "STAFF" });
    await expect(
      bookAtVisit(at("13:00"), {
        guest: visitor(owner.user.email, "+79005551007"),
      }),
    ).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
  });
});

describe("staff book without the balance", () => {
  it("books a client with an empty balance and logs no credits", async () => {
    const { member } = await joinAsClient("+79005551008");
    const booking = await call(
      bookingRouter.book,
      {
        practiceId,
        startsAt: at("07:00", "2030-01-28"),
        serviceId: longId,
        memberId: member.id,
      },
      { context: api.context(owner) },
    );
    expect(booking).toMatchObject({ credits: 0, balance: 0 });

    const series = await call(
      bookingRouter.bookSeries,
      {
        practiceId,
        startsAt: at("10:00", "2030-01-28"),
        intervalWeeks: 1,
        count: 3,
        memberId: member.id,
      },
      { context: api.context(owner) },
    );
    expect(series.dates).toHaveLength(3);
    const entries = await api.db.query.CreditEntry.findMany({
      where: eq(CreditEntry.memberId, member.id),
    });
    expect(entries).toEqual([]);

    // A no-show is only a mark: the balance stays as it was.
    const started = Date.now() - 10 * 60_000;
    await api.db
      .update(Booking)
      .set({
        startsAt: new Date(started),
        endsAt: new Date(started + 5_400_000),
      })
      .where(eq(Booking.id, booking.id));
    await call(
      bookingRouter.markNoShow,
      { bookingId: booking.id },
      { context: api.context(owner) },
    );
    const after = await api.db.query.PracticeMember.findFirst({
      where: eq(PracticeMember.id, member.id),
    });
    expect(after?.credits).toBe(0);
  });

  it("charges the balance again once the switch is off", async () => {
    await setPayAtVisit(false);
    const { member } = await joinAsClient("+79005551009");
    await expect(
      call(
        bookingRouter.book,
        {
          practiceId,
          startsAt: at("14:00", "2030-01-28"),
          memberId: member.id,
        },
        { context: api.context(owner) },
      ),
    ).rejects.toMatchObject({ code: "NO_CREDITS" });
    await call(
      creditRouter.grant,
      { practiceId, memberId: member.id, delta: 1 },
      { context: api.context(owner) },
    );
    const booking = await call(
      bookingRouter.book,
      {
        practiceId,
        startsAt: at("14:00", "2030-01-28"),
        memberId: member.id,
      },
      { context: api.context(owner) },
    );
    expect(booking).toMatchObject({ credits: 1, balance: 0 });
    await setPayAtVisit(true);
  });
});

describe("notices", () => {
  it("tells staff only: the client's mail is the link", async () => {
    const { token } = await bookAtVisit(at("07:00", "2030-02-04"), {
      guest: visitor("notice@visit.test", "+79005551010"),
    });
    const booking = await bookingByToken(token);
    const sent: TemplateEmail[] = [];
    await notifyBookingConfirmed(
      api.db,
      booking.id,
      async (message) => {
        sent.push(message);
      },
      { client: false },
    );
    expect(sent.map((m) => m.template)).toEqual(["staff-booking"]);
    expect(sent[0]?.props).toMatchObject({ free: false, charged: false });
  });
});

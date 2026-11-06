import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import {
  Booking,
  eq,
  PracticeMember,
  Service,
  WaitlistEntry,
} from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { availabilityRouter } from "../availability";
import { bookingRouter } from "../booking";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { serviceRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;

// 2030-01-07 is a Monday; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const at = (utc: string) => new Date(`2030-01-07T${utc}:00Z`);
/** Two weeks on: nothing else books these Mondays. */
const later = (utc: string) => new Date(`2030-01-21T${utc}:00Z`);

let owner: Session;
let practiceId: string;
let otherPracticeId: string;
let otherOwner: Session;

async function newClient(credits = 0) {
  const session = await createSession(api.db);
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  if (credits) {
    await call(
      creditRouter.grant,
      { practiceId, memberId: member.id, delta: credits },
      { context: api.context(owner) },
    );
  }
  return { session, memberId: member.id };
}

const list = (session: Session, id = practiceId) =>
  call(
    serviceRouter.list,
    { practiceId: id },
    { context: api.context(session) },
  );

const save = (
  session: Session,
  services: {
    id?: string;
    name: string;
    minutes: number;
    credits: number;
    active?: boolean;
  }[],
) =>
  call(
    serviceRouter.save,
    {
      practiceId,
      services: services.map((s) => ({ active: true, ...s })),
    },
    { context: api.context(session) },
  );

async function balance(session: Session) {
  const practice = await call(
    practiceRouter.get,
    { practiceId },
    { context: api.context(session) },
  );
  return practice.membership.credits;
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-s", profession: "tutor" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  // Monday 10:00–13:00 MSK.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );

  otherOwner = await createSession(api.db);
  const other = await call(
    practiceRouter.create,
    { name: "Борис", slug: "boris-s", profession: "coach" },
    { context: api.context(otherOwner) },
  );
  otherPracticeId = other.id;
});
afterAll(async () => {
  if (api) await api.close();
});

describe("a new practice", () => {
  it("starts with one service named in its profession's words", async () => {
    const { services } = await list(owner);
    expect(services).toEqual([
      expect.objectContaining({
        name: "Занятие",
        minutes: 60,
        credits: 1,
        active: true,
      }),
    ]);
  });

  it("offers its active services on the public page", async () => {
    const page = await call(
      practiceRouter.bySlug,
      { slug: "anna-s" },
      { context: api.context() },
    );
    expect(page.services).toHaveLength(1);
    expect(page.services[0]).toMatchObject({ name: "Занятие", minutes: 60 });
  });
});

describe("service.save", () => {
  it("keeps ids, order and the switched-off ones off the public page", async () => {
    const [first] = (await list(owner)).services;
    if (!first) throw new Error("no service");
    const saved = await save(owner, [
      { id: first.id, name: "Занятие", minutes: 60, credits: 1 },
      { name: "Длинное занятие", minutes: 90, credits: 2 },
      { name: "Скрытое", minutes: 30, credits: 1, active: false },
    ]);
    expect(saved.services.map((s) => s.name)).toEqual([
      "Занятие",
      "Длинное занятие",
      "Скрытое",
    ]);
    expect(saved.services[0]?.id).toBe(first.id);

    const page = await call(
      practiceRouter.bySlug,
      { slug: "anna-s" },
      { context: api.context() },
    );
    expect(page.services.map((s) => s.name)).toEqual([
      "Занятие",
      "Длинное занятие",
    ]);
  });

  it("is the owner's: a client is refused", async () => {
    const { session } = await newClient();
    await expect(save(session, [])).rejects.toBeDefined();
    await expect(
      save(session, [{ name: "Моё", minutes: 60, credits: 1 }]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(list(session)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps at least one service on", async () => {
    await expect(
      save(owner, [
        { name: "Занятие", minutes: 60, credits: 1, active: false },
      ]),
    ).rejects.toBeDefined();
    await expect(save(owner, [])).rejects.toBeDefined();
  });

  it("rejects lengths off the 5-minute step", async () => {
    await expect(
      save(owner, [{ name: "Занятие", minutes: 47, credits: 1 }]),
    ).rejects.toBeDefined();
  });

  it("deletes an unused service and archives one bookings or wishes point at", async () => {
    const current = (await list(owner)).services;
    const keep = current.find((s) => s.name === "Занятие");
    const long = current.find((s) => s.name === "Длинное занятие");
    const hidden = current.find((s) => s.name === "Скрытое");
    if (!keep || !long || !hidden) throw new Error("services missing");

    // «Длинное занятие» has a booking, «Скрытое» only a wish.
    const { session } = await newClient(2);
    await call(
      bookingRouter.book,
      { practiceId, startsAt: at("07:00"), serviceId: long.id },
      { context: api.context(session) },
    );
    await api.db.insert(WaitlistEntry).values({
      practiceId,
      userId: session.user.id,
      serviceId: hidden.id,
      fromDate: "2030-01-07",
      toDate: "2030-01-13",
    });

    const saved = await save(owner, [
      { id: keep.id, name: "Занятие", minutes: 60, credits: 1 },
    ]);
    // Archived services are out of the editor, and out of its limit.
    expect(saved.services.map((s) => s.name)).toEqual(["Занятие"]);
    expect((await list(owner)).services.map((s) => s.name)).toEqual([
      "Занятие",
    ]);

    // They are still there for the booking and the wish, never offered.
    const rows = await api.db.query.Service.findMany({
      where: eq(Service.practiceId, practiceId),
    });
    const archived = rows.filter((r) => r.archived);
    expect(archived.map((r) => r.name).sort()).toEqual([
      "Длинное занятие",
      "Скрытое",
    ]);
    expect(archived.every((r) => !r.active)).toBe(true);
    const wish = await api.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.practiceId, practiceId),
    });
    expect(wish?.serviceId).toBe(hidden.id);

    // Put the long one back for the tests below (as a new service).
    await save(owner, [
      { id: keep.id, name: "Занятие", minutes: 60, credits: 1 },
      { name: "Длинное занятие", minutes: 90, credits: 2 },
    ]);
  });
});

describe("booking with a service", () => {
  it("offers slots as long as the service, on the half hour for 90 minutes", async () => {
    const { services } = await list(owner);
    const long = services.find((s) => s.name === "Длинное занятие");
    if (!long) throw new Error("service missing");

    const result = await call(
      bookingRouter.slots,
      { practiceId, from: "2030-01-14", days: 1, serviceId: long.id },
      { context: api.context() },
    );
    // 10:00–13:00 holds 10:00–11:30, 10:30–12:00, 11:00–12:30, 11:30–13:00.
    expect(
      result.slots.map((s) => [
        s.startsAt.toISOString().slice(11, 16),
        (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000,
      ]),
    ).toEqual([
      ["07:00", 90],
      ["07:30", 90],
      ["08:00", 90],
      ["08:30", 90],
    ]);

    // An hour keeps to the hour, as before services.
    const hour = await call(
      bookingRouter.slots,
      { practiceId, from: "2030-01-14", days: 1 },
      { context: api.context() },
    );
    expect(
      hour.slots.map((s) => s.startsAt.toISOString().slice(11, 16)),
    ).toEqual(["07:00", "08:00", "09:00"]);
  });

  it("takes the service's price from the balance and gives it back", async () => {
    const { services } = await list(owner);
    const long = services.find((s) => s.name === "Длинное занятие");
    if (!long) throw new Error("service missing");
    const { session } = await newClient(3);

    const booking = await call(
      bookingRouter.book,
      { practiceId, startsAt: at("08:30"), serviceId: long.id },
      { context: api.context(session) },
    );
    // `balance` is what is left of the 3; `credits` the booking's price.
    expect(booking.balance).toBe(1);
    expect(booking.credits).toBe(2);
    expect(booking.endsAt.getTime() - booking.startsAt.getTime()).toBe(
      90 * 60_000,
    );
    const row = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, booking.id),
    });
    expect(row).toMatchObject({ serviceId: long.id, credits: 2 });

    await call(
      bookingRouter.cancel,
      { bookingId: booking.id },
      { context: api.context(session) },
    );
    expect(await balance(session)).toBe(3);
  });

  it("refuses a client with too few credits for a longer service", async () => {
    const { services } = await list(owner);
    const long = services.find((s) => s.name === "Длинное занятие");
    if (!long) throw new Error("service missing");
    const { session } = await newClient(1);

    await expect(
      call(
        bookingRouter.book,
        { practiceId, startsAt: at("07:30"), serviceId: long.id },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "NO_CREDITS" });
    expect(await balance(session)).toBe(1);
  });

  it("books the first service when none is named", async () => {
    const { session } = await newClient(1);
    const booking = await call(
      bookingRouter.book,
      { practiceId, startsAt: at("09:00") },
      { context: api.context(session) },
    );
    const row = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, booking.id),
    });
    expect(row).toMatchObject({ credits: 1 });
    expect(row?.serviceId).not.toBeNull();
    expect(booking.endsAt.getTime() - booking.startsAt.getTime()).toBe(
      60 * 60_000,
    );
  });

  it("rejects a service of another practice or one switched off", async () => {
    const foreign = (await list(otherOwner, otherPracticeId)).services[0];
    if (!foreign) throw new Error("setup failed");
    const { session } = await newClient(4);

    for (const serviceId of [crypto.randomUUID(), foreign.id]) {
      await expect(
        call(
          bookingRouter.book,
          { practiceId, startsAt: at("07:00"), serviceId },
          { context: api.context(session) },
        ),
      ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
    }

    const { services } = await list(owner);
    const hidden = await save(
      owner,
      services.map((s) => ({ ...s, active: s.name !== "Длинное занятие" })),
    );
    const off = hidden.services.find((s) => !s.active);
    if (!off) throw new Error("setup failed");
    await expect(
      call(
        bookingRouter.slots,
        { practiceId, from: "2030-01-07", days: 1, serviceId: off.id },
        { context: api.context() },
      ),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
    await expect(
      call(
        bookingRouter.book,
        { practiceId, startsAt: at("07:00"), serviceId: off.id },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });

    await save(
      owner,
      services.map((s) => ({ ...s, active: true })),
    );
  });

  it("books a series of a longer service for its price each", async () => {
    const { services } = await list(owner);
    const long = services.find((s) => s.name === "Длинное занятие");
    if (!long) throw new Error("service missing");
    const { session } = await newClient(6);

    const preview = await call(
      bookingRouter.seriesPreview,
      {
        practiceId,
        startsAt: later("07:00"),
        intervalWeeks: 1,
        count: 3,
        serviceId: long.id,
      },
      { context: api.context(session) },
    );
    expect(preview.price).toBe(2);
    expect(
      preview.dates.every(
        (d) => d.endsAt.getTime() - d.startsAt.getTime() === 90 * 60_000,
      ),
    ).toBe(true);

    const series = await call(
      bookingRouter.bookSeries,
      {
        practiceId,
        startsAt: later("07:00"),
        intervalWeeks: 1,
        count: 3,
        serviceId: long.id,
      },
      { context: api.context(session) },
    );
    expect(series.credits).toBe(0);
    expect(await balance(session)).toBe(0);

    const { seriesId } = series;
    await call(
      bookingRouter.cancelSeries,
      { seriesId },
      { context: api.context(session) },
    );
    // Cancelled a week ahead of a 2030 date: all three prices come back.
    expect(await balance(session)).toBe(6);
  });
});

describe("staff access", () => {
  it("lets an administrator read the list but not save it", async () => {
    const admin = await createSession(api.db);
    await api.db
      .insert(PracticeMember)
      .values({ practiceId, userId: admin.user.id, role: "admin" });
    expect((await list(admin)).services.length).toBeGreaterThan(0);
    await expect(
      save(admin, [{ name: "Моё", minutes: 60, credits: 1 }]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

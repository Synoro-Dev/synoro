import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, BookingSeries, CreditEntry, eq } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { seriesSlots, seriesStarts } from "../../lib/schedule";
import { availabilityRouter } from "../availability";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;
/** Monday 7 January 2030, 10:00 Moscow time. */
const MONDAY_10 = new Date("2030-01-07T10:00:00+03:00");

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;

async function newClient(credits: number) {
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

async function balance(memberId: string) {
  const member = await api.db.query.PracticeMember.findFirst({
    where: (m, { eq }) => eq(m.id, memberId),
  });
  return member?.credits;
}

const seriesBookings = (seriesId: string) =>
  api.db.query.Booking.findMany({
    where: eq(Booking.seriesId, seriesId),
    orderBy: (b, { asc }) => asc(b.startsAt),
  });

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-series", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  // Mondays 10:00–13:00 Moscow time.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );
});
afterAll(async () => {
  if (api) await api.close();
});

describe("seriesStarts", () => {
  it("keeps the local time every week and every other week", () => {
    const weekly = seriesStarts(MONDAY_10, 1, 3, "Europe/Moscow");
    expect(weekly.map((d) => d.toISOString())).toEqual([
      "2030-01-07T07:00:00.000Z",
      "2030-01-14T07:00:00.000Z",
      "2030-01-21T07:00:00.000Z",
    ]);
    const biweekly = seriesStarts(MONDAY_10, 2, 2, "Europe/Moscow");
    expect(biweekly[1]?.toISOString()).toBe("2030-01-21T07:00:00.000Z");
  });

  it("keeps 19:00 across a daylight saving change", () => {
    // Berlin moves to summer time on 31 March 2030.
    const first = new Date("2030-03-25T19:00:00+01:00");
    const [, second] = seriesStarts(first, 1, 2, "Europe/Berlin");
    expect(second?.toISOString()).toBe("2030-04-01T17:00:00.000Z");
  });

  it("marks a wall time that a daylight saving jump skips", () => {
    // Berlin: 02:30 does not exist on Sunday 31 March 2030.
    const first = new Date("2030-03-24T02:30:00+01:00");
    const [before, skipped, after] = seriesSlots(first, 1, 3, "Europe/Berlin");
    expect(before?.exists).toBe(true);
    expect(skipped?.exists).toBe(false);
    expect(after?.exists).toBe(true);
  });
});

describe("booking.seriesPreview", () => {
  it("marks taken and off-schedule dates", async () => {
    const { session } = await newClient(4);
    const other = await newClient(1);
    await call(
      bookingRouter.book,
      { practiceId, startsAt: new Date(MONDAY_10.getTime() + WEEK) },
      { context: api.context(other.session) },
    );

    const preview = await call(
      bookingRouter.seriesPreview,
      { practiceId, startsAt: MONDAY_10, intervalWeeks: 1, count: 3 },
      { context: api.context(session) },
    );
    expect(preview.dates.map((d) => d.status)).toEqual([
      "free",
      "booked",
      "free",
    ]);
    expect(preview.credits).toBe(4);

    const tuesday = await call(
      bookingRouter.seriesPreview,
      {
        practiceId,
        startsAt: new Date("2030-01-08T10:00:00+03:00"),
        intervalWeeks: 1,
        count: 2,
      },
      { context: api.context(session) },
    );
    expect(tuesday.dates.map((d) => d.status)).toEqual([
      "off_schedule",
      "off_schedule",
    ]);
  });
});

describe("booking.bookSeries", () => {
  // Each test books its own hour of the Monday window, weeks apart.
  const start = (hour: number, week = 10) =>
    new Date(MONDAY_10.getTime() + week * WEEK + hour * HOUR);

  it("books every date at once, one credit and one entry each", async () => {
    const { session, memberId } = await newClient(5);
    const result = await call(
      bookingRouter.bookSeries,
      { practiceId, startsAt: start(0), intervalWeeks: 1, count: 4 },
      { context: api.context(session) },
    );
    expect(result.dates).toHaveLength(4);
    expect(result.credits).toBe(1);
    expect(await balance(memberId)).toBe(1);

    const bookings = await seriesBookings(result.seriesId);
    expect(bookings.map((b) => b.startsAt.getTime())).toEqual(
      [0, 1, 2, 3].map((i) => start(0).getTime() + i * WEEK),
    );
    const entries = await api.db.query.CreditEntry.findMany({
      where: eq(CreditEntry.memberId, memberId),
    });
    expect(entries.filter((e) => e.reason === "booking")).toHaveLength(4);
    const series = await api.db.query.BookingSeries.findFirst({
      where: eq(BookingSeries.id, result.seriesId),
    });
    expect(series).toMatchObject({ intervalWeeks: 1, count: 4 });
  });

  it("books nothing when the balance is short", async () => {
    const { session, memberId } = await newClient(3);
    const error = await call(
      bookingRouter.bookSeries,
      { practiceId, startsAt: start(1), intervalWeeks: 1, count: 4 },
      { context: api.context(session) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "NO_CREDITS" });
    expect(await balance(memberId)).toBe(3);
    const taken = await api.db.query.Booking.findMany({
      where: eq(Booking.startsAt, start(1)),
    });
    expect(taken).toEqual([]);
  });

  it("names the dates that are taken, and books around skipped ones", async () => {
    const { session, memberId } = await newClient(4);
    const other = await newClient(1);
    const taken = start(2, 21);
    await call(
      bookingRouter.book,
      { practiceId, startsAt: taken },
      { context: api.context(other.session) },
    );

    const input = {
      practiceId,
      startsAt: start(2, 20),
      intervalWeeks: 1 as const,
      count: 4,
    };
    const error = await call(bookingRouter.bookSeries, input, {
      context: api.context(session),
    }).catch((e) => e);
    expect(error).toMatchObject({
      code: "SLOT_UNAVAILABLE",
      data: { dates: [taken] },
    });
    expect(await balance(memberId)).toBe(4);

    const result = await call(
      bookingRouter.bookSeries,
      { ...input, skip: [taken] },
      { context: api.context(session) },
    );
    expect(result.dates).toHaveLength(3);
    expect(await balance(memberId)).toBe(1);
  });

  it("needs at least two dates", async () => {
    const { session } = await newClient(2);
    const error = await call(
      bookingRouter.bookSeries,
      {
        practiceId,
        startsAt: start(0, 30),
        intervalWeeks: 2,
        count: 2,
        skip: [start(0, 32)],
      },
      { context: api.context(session) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "TOO_FEW" });
  });

  it("lets staff book a client, but not a client book another", async () => {
    const { memberId } = await newClient(2);
    const intruder = await newClient(2);
    const error = await call(
      bookingRouter.bookSeries,
      {
        practiceId,
        startsAt: start(0, 40),
        intervalWeeks: 1,
        count: 2,
        memberId,
      },
      { context: api.context(intruder.session) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "FORBIDDEN" });

    const result = await call(
      bookingRouter.bookSeries,
      {
        practiceId,
        startsAt: start(0, 40),
        intervalWeeks: 1,
        count: 2,
        memberId,
      },
      { context: api.context(owner) },
    );
    expect(result.credits).toBe(0);
    const [first] = await seriesBookings(result.seriesId);
    expect(first?.memberId).toBe(memberId);
  });
});

describe("booking.cancelSeries", () => {
  const start = (week: number) => new Date(MONDAY_10.getTime() + week * WEEK);

  it("lets the client cancel what is more than a day ahead", async () => {
    const { session, memberId } = await newClient(3);
    const { seriesId } = await call(
      bookingRouter.bookSeries,
      { practiceId, startsAt: start(50), intervalWeeks: 1, count: 3 },
      { context: api.context(session) },
    );
    // Move the first booking to within a day.
    const [first] = await seriesBookings(seriesId);
    if (!first) throw new Error("no booking");
    const soon = new Date(Date.now() + 10 * HOUR);
    await api.db
      .update(Booking)
      .set({ startsAt: soon, endsAt: new Date(soon.getTime() + HOUR) })
      .where(eq(Booking.id, first.id));

    const result = await call(
      bookingRouter.cancelSeries,
      { seriesId },
      { context: api.context(session) },
    );
    expect(result).toEqual({ cancelled: 2, refunded: 2, kept: 1 });
    expect(await balance(memberId)).toBe(2);
    const bookings = await seriesBookings(seriesId);
    expect(bookings.map((b) => b.status)).toEqual([
      "active",
      "cancelled",
      "cancelled",
    ]);
    const series = await api.db.query.BookingSeries.findFirst({
      where: eq(BookingSeries.id, seriesId),
    });
    expect(series?.cancelledAt).toBeNull();
  });

  it("lets staff cancel everything, without a refund if asked", async () => {
    const { session, memberId } = await newClient(2);
    const { seriesId } = await call(
      bookingRouter.bookSeries,
      { practiceId, startsAt: start(60), intervalWeeks: 2, count: 2 },
      { context: api.context(session) },
    );
    const result = await call(
      bookingRouter.cancelSeries,
      { seriesId, refund: false },
      { context: api.context(owner) },
    );
    expect(result).toEqual({ cancelled: 2, refunded: 0, kept: 0 });
    expect(await balance(memberId)).toBe(0);
    const bookings = await seriesBookings(seriesId);
    expect(bookings.every((b) => b.cancelReason === "staff")).toBe(true);
    const series = await api.db.query.BookingSeries.findFirst({
      where: eq(BookingSeries.id, seriesId),
    });
    expect(series?.cancelledAt).not.toBeNull();
  });

  it("hides another client's series", async () => {
    const { session } = await newClient(2);
    const stranger = await newClient(0);
    const { seriesId } = await call(
      bookingRouter.bookSeries,
      { practiceId, startsAt: start(70), intervalWeeks: 1, count: 2 },
      { context: api.context(session) },
    );
    const error = await call(
      bookingRouter.cancelSeries,
      { seriesId },
      { context: api.context(stranger.session) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });
});

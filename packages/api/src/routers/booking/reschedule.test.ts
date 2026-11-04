import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import {
  and,
  Booking,
  CreditEntry,
  eq,
  isNull,
  PracticeMember,
} from "@synoro/db";
import {
  type Deliver,
  notifyBookingMoved,
  sendBookingReminders,
} from "@synoro/jobs/booking-video";

import { createSession, setupTestApi } from "../../../test/helpers";
import { cancelBookingRows } from "../../lib/bookings";
import { availabilityRouter } from "../availability";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CREDITS = 10;

type Mail = Parameters<Deliver>[0];

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let admin: Session;
let client: Session;
let practiceId: string;
let memberId: string;

/** 10:00 UTC, `day` days into 2030; every hour of every day is open. */
const at = (day: number, hour = 10) =>
  new Date(Date.UTC(2030, 0, 1 + day, hour));

/** A whole hour at least `ms` from now. */
function hourAfter(ms: number) {
  return new Date(Math.ceil((Date.now() + ms) / HOUR) * HOUR);
}

function book(startsAt: Date, session = client) {
  return call(
    bookingRouter.book,
    { practiceId, startsAt },
    { context: api.context(session) },
  );
}

function reschedule(bookingId: string, startsAt: Date, session = client) {
  return call(
    bookingRouter.reschedule,
    { bookingId, startsAt },
    { context: api.context(session) },
  );
}

/** A confirmed booking `inMs` from now that skips the procedures' checks. */
async function insertBooking(
  inMs: number,
  values: Partial<typeof Booking.$inferInsert> = {},
) {
  const startsAt = hourAfter(inMs);
  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      memberId,
      ...values,
    })
    .returning();
  if (!booking) throw new Error("no booking");
  return booking;
}

const findBooking = (id: string) =>
  api.db.query.Booking.findFirst({ where: eq(Booking.id, id) });

async function balance() {
  const row = await api.db.query.PracticeMember.findFirst({
    where: eq(PracticeMember.id, memberId),
  });
  return row?.credits;
}

const journal = () =>
  api.db.select().from(CreditEntry).where(eq(CreditEntry.memberId, memberId));

async function freeStarts(day: number) {
  const { slots } = await call(
    bookingRouter.slots,
    {
      practiceId,
      from: at(day).toISOString().slice(0, 10),
      days: 1,
    },
    { context: api.context() },
  );
  return slots.map((slot) => slot.startsAt.getTime());
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, {
    name: "Анна",
    email: "anna@move.test",
  });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-move", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  await call(
    availabilityRouter.replace,
    {
      practiceId,
      rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        startMinute: 0,
        endMinute: 1440,
      })),
    },
    { context: api.context(owner) },
  );
  admin = await createSession(api.db, {
    name: "Ольга",
    email: "olga@move.test",
  });
  await api.db
    .insert(PracticeMember)
    .values({ practiceId, userId: admin.user.id, role: "admin" });
  client = await createSession(api.db, {
    name: "Иван",
    email: "ivan@move.test",
  });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(client) },
  );
  memberId = member.id;
  await call(
    creditRouter.grant,
    { practiceId, memberId, delta: CREDITS },
    { context: api.context(owner) },
  );
});
afterAll(async () => {
  if (api) await api.close();
});
beforeEach(async () => {
  await api.db.delete(Booking).where(eq(Booking.practiceId, practiceId));
  await api.db.delete(CreditEntry).where(eq(CreditEntry.memberId, memberId));
  await api.db
    .update(PracticeMember)
    .set({ credits: CREDITS })
    .where(eq(PracticeMember.id, memberId));
});

describe("booking.reschedule", () => {
  it("moves the booking: same id, new time, the old one free again", async () => {
    const booking = await book(at(5));

    const moved = await reschedule(booking.id, at(6));

    expect(moved).toEqual({
      id: booking.id,
      startsAt: at(6),
      endsAt: at(6, 11),
    });
    const row = await findBooking(booking.id);
    expect(row).toMatchObject({
      status: "active",
      startsAt: at(6),
      endsAt: at(6, 11),
    });
    expect(await freeStarts(5)).toContain(at(5).getTime());
    expect(await freeStarts(6)).not.toContain(at(6).getTime());
  });

  it("leaves the balance and its journal alone", async () => {
    const booking = await book(at(5));
    const before = await journal();
    expect(await balance()).toBe(CREDITS - 1);

    await reschedule(booking.id, at(6));

    expect(await balance()).toBe(CREDITS - 1);
    expect(await journal()).toEqual(before);
  });

  it("refuses a taken time and leaves everything as it was", async () => {
    const booking = await book(at(5));
    await book(at(6));
    const credits = await balance();

    const error = await reschedule(booking.id, at(6)).catch((e) => e);

    expect(error).toMatchObject({ code: "SLOT_UNAVAILABLE", defined: true });
    expect(await findBooking(booking.id)).toMatchObject({
      status: "active",
      startsAt: at(5),
      endsAt: at(5, 11),
    });
    expect(await balance()).toBe(credits);
    // The old time was never released.
    expect(await freeStarts(5)).not.toContain(at(5).getTime());
  });

  it("lets one of two moves to the same time win", async () => {
    const [first, second] = await Promise.all([book(at(5)), book(at(6))]);
    const results = await Promise.allSettled([
      reschedule(first.id, at(7)),
      reschedule(second.id, at(7)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const loser = results.find((r) => r.status === "rejected");
    expect(loser?.reason).toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("refuses a time off the schedule, also for staff", async () => {
    const booking = await book(at(5));
    const halfPast = new Date(at(6).getTime() + HOUR / 2);
    for (const session of [client, owner]) {
      const error = await reschedule(booking.id, halfPast, session).catch(
        (e) => e,
      );
      expect(error).toMatchObject({ code: "SLOT_UNAVAILABLE" });
    }
    const past = await reschedule(booking.id, new Date(Date.now() - DAY)).catch(
      (e) => e,
    );
    expect(past).toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("takes the time of an unpaid hold that ran out", async () => {
    const booking = await book(at(5));
    await api.db.insert(Booking).values({
      practiceId,
      kind: "consultation",
      startsAt: at(6),
      endsAt: at(6, 11),
      memberId,
      holdUntil: new Date(Date.now() - HOUR),
    });

    await reschedule(booking.id, at(6));

    expect(await findBooking(booking.id)).toMatchObject({ startsAt: at(6) });
  });

  it("does nothing when the booking is already at that time", async () => {
    const booking = await book(at(5));
    const moved = await reschedule(booking.id, at(5));
    expect(moved.startsAt).toEqual(at(5));
    expect(await findBooking(booking.id)).toMatchObject({ startsAt: at(5) });
  });
});

describe("the 24-hour rule", () => {
  it("refuses a client within 24 hours", async () => {
    const booking = await insertBooking(3 * HOUR);
    const error = await reschedule(booking.id, at(6)).catch((e) => e);
    expect(error).toMatchObject({ code: "TOO_LATE", defined: true });
    expect(await findBooking(booking.id)).toMatchObject({
      startsAt: booking.startsAt,
    });
  });

  it("lets a client move one just over 24 hours away", async () => {
    const booking = await insertBooking(25 * HOUR);
    await reschedule(booking.id, at(6));
    expect(await findBooking(booking.id)).toMatchObject({ startsAt: at(6) });
  });

  it("lets staff move at any time", async () => {
    for (const session of [owner, admin]) {
      const booking = await insertBooking(3 * HOUR);
      const target = session === owner ? at(6) : at(7);
      await reschedule(booking.id, target, session);
      expect(await findBooking(booking.id)).toMatchObject({ startsAt: target });
    }
  });

  it("lets a client move a free intro until it starts", async () => {
    const startsAt = hourAfter(2 * HOUR);
    const intro = await insertBooking(2 * HOUR, {
      kind: "free",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR / 2),
    });
    await reschedule(intro.id, at(6));
    const row = await findBooking(intro.id);
    expect(row).toMatchObject({ startsAt: at(6) });
    // It keeps its length, whatever the practice's is now.
    expect(row?.endsAt).toEqual(new Date(at(6).getTime() + HOUR / 2));
  });
});

describe("what may be moved", () => {
  it("only this booking of a series", async () => {
    await call(
      bookingRouter.bookSeries,
      { practiceId, startsAt: at(5), intervalWeeks: 1, count: 3 },
      { context: api.context(client) },
    );
    const before = await api.db.query.Booking.findMany({
      where: eq(Booking.practiceId, practiceId),
      orderBy: Booking.startsAt,
    });
    const [first, second, third] = before;
    if (!first || !second || !third) throw new Error("no series");
    const credits = await balance();

    await reschedule(second.id, at(13));

    expect(await findBooking(second.id)).toMatchObject({
      startsAt: at(13),
      seriesId: first.seriesId,
    });
    expect(await findBooking(first.id)).toMatchObject({ startsAt: at(5) });
    expect(await findBooking(third.id)).toMatchObject({ startsAt: at(19) });
    expect(await balance()).toBe(credits);
  });

  it("not someone else's booking", async () => {
    const booking = await book(at(5));
    const stranger = await createSession(api.db, { name: "Мария" });
    const error = await reschedule(booking.id, at(6), stranger).catch((e) => e);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("not a cancelled booking, closed time or an unpaid hold", async () => {
    const cancelled = await insertBooking(3 * DAY, {
      status: "cancelled",
      cancelReason: "client",
      cancelledAt: new Date(),
    });
    const closed = await insertBooking(4 * DAY, {
      kind: "blocked",
      memberId: null,
    });
    const held = await insertBooking(5 * DAY, {
      holdUntil: new Date(Date.now() + HOUR),
    });
    for (const id of [cancelled.id, closed.id, held.id]) {
      const error = await reschedule(id, at(6), owner).catch((e) => e);
      expect(error).toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("booking.rescheduleSlots", () => {
  const starts = async (
    bookingId: string,
    day: number,
    session: Session = client,
  ) => {
    const { slots } = await call(
      bookingRouter.rescheduleSlots,
      { bookingId, from: at(day).toISOString().slice(0, 10), days: 1 },
      { context: api.context(session) },
    );
    return slots.map((slot) => slot.startsAt.getTime());
  };
  /** A free intro of `minutes`, whatever the practice's length (30) is. */
  async function intro(minutes: number) {
    const [booking] = await api.db
      .insert(Booking)
      .values({
        practiceId,
        kind: "free",
        startsAt: at(5),
        endsAt: new Date(at(5).getTime() + minutes * 60_000),
        memberId,
      })
      .returning();
    if (!booking) throw new Error("no booking");
    return booking;
  }

  it("leaves out the current start and other bookings", async () => {
    const booking = await book(at(5));
    await book(at(5, 12));
    const free = await starts(booking.id, 5);
    expect(free).not.toContain(at(5).getTime());
    expect(free).not.toContain(at(5, 12).getTime());
    expect(free).toContain(at(5, 11).getTime());
  });

  it("doesn't count the booking's own time as busy", async () => {
    const booking = await intro(60);
    const halfPast = new Date(at(5).getTime() + HOUR / 2);
    expect(await starts(booking.id, 5)).toContain(halfPast.getTime());

    await reschedule(booking.id, halfPast);
    expect(await findBooking(booking.id)).toMatchObject({
      startsAt: halfPast,
      endsAt: new Date(halfPast.getTime() + HOUR),
    });
  });

  it("fits the booking's own length, not the practice's", async () => {
    // The day ends at 24:00 MSK, 21:00Z.
    const lastHalfHour = at(6, 20).getTime() + HOUR / 2;
    const long = await intro(60);
    expect(await starts(long.id, 6)).not.toContain(lastHalfHour);

    await api.db.delete(Booking).where(eq(Booking.id, long.id));
    const short = await intro(30);
    expect(await starts(short.id, 6)).toContain(lastHalfHour);
  });

  it("has the access rules of a move", async () => {
    const booking = await book(at(5));
    const stranger = await createSession(api.db, { name: "Мария" });
    const refused = await starts(booking.id, 6, stranger).catch((e) => e);
    expect(refused).toMatchObject({ code: "NOT_FOUND" });

    const late = await insertBooking(3 * HOUR);
    const tooLate = await starts(late.id, 6).catch((e) => e);
    expect(tooLate).toMatchObject({ code: "TOO_LATE" });
    expect(await starts(late.id, 6, owner)).toContain(at(6).getTime());
  });
});

describe("what read the booking before it moved", () => {
  it("a client's cancel doesn't go through", async () => {
    const booking = await book(at(5));
    const credits = await balance();
    await reschedule(booking.id, at(6), owner);

    const cancelled = await cancelBookingRows(api.db, booking.id, {
      cancelledById: client.user.id,
      refund: true,
      reason: "client",
      startsAt: at(5),
    });

    expect(cancelled).toBeUndefined();
    expect(await findBooking(booking.id)).toMatchObject({ status: "active" });
    expect(await balance()).toBe(credits);
  });

  it("the reminder cron sends nothing and marks nothing", async () => {
    // Three short bookings within the hour: all due for the hour reminder.
    const soon = [10, 25, 40].map((minutes) => {
      const startsAt = new Date(Date.now() + minutes * 60_000);
      return {
        practiceId,
        kind: "consultation" as const,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 5 * 60_000),
        memberId,
      };
    });
    await api.db.insert(Booking).values(soon);

    // The batch is read before the first mail: the rest move during it.
    let moved = false;
    const mails: Mail[] = [];
    await sendBookingReminders(api.db, async (mail) => {
      mails.push(mail);
      if (moved) return;
      moved = true;
      const unclaimed = await api.db.query.Booking.findMany({
        where: and(
          eq(Booking.practiceId, practiceId),
          isNull(Booking.reminderHourSentAt),
        ),
      });
      for (const [i, { id }] of unclaimed.entries()) {
        await api.db
          .update(Booking)
          .set({ startsAt: at(6 + i), endsAt: at(6 + i, 11) })
          .where(eq(Booking.id, id));
      }
    });

    expect(mails).toHaveLength(1);
    const rows = await api.db.query.Booking.findMany({
      where: eq(Booking.practiceId, practiceId),
    });
    expect(rows.filter((r) => r.reminderHourSentAt !== null)).toHaveLength(1);
    expect(rows.filter((r) => r.reminderDaySentAt !== null)).toHaveLength(1);
  });
});

describe("after a move", () => {
  it("starts the reminders over", async () => {
    const booking = await insertBooking(25 * HOUR, {
      reminderDaySentAt: new Date(),
      reminderHourSentAt: new Date(),
    });
    await reschedule(booking.id, at(6));
    expect(await findBooking(booking.id)).toMatchObject({
      reminderDaySentAt: null,
      reminderHourSentAt: null,
    });
  });

  it("counts a reminder already due as covered by the mail", async () => {
    const booking = await insertBooking(3 * DAY, {
      reminderDaySentAt: new Date(),
    });
    await reschedule(booking.id, hourAfter(5 * HOUR));
    const row = await findBooking(booking.id);
    expect(row?.reminderDaySentAt).not.toBeNull();
    expect(row?.reminderHourSentAt).toBeNull();
  });

  it("remembers the client's zone, not the zone of staff", async () => {
    const booking = await book(at(5));
    await call(
      bookingRouter.reschedule,
      { bookingId: booking.id, startsAt: at(6), timezone: "Asia/Novosibirsk" },
      { context: api.context(client) },
    );
    expect((await findBooking(booking.id))?.clientTimezone).toBe(
      "Asia/Novosibirsk",
    );

    await call(
      bookingRouter.reschedule,
      { bookingId: booking.id, startsAt: at(7), timezone: "Asia/Tokyo" },
      { context: api.context(owner) },
    );
    expect((await findBooking(booking.id))?.clientTimezone).toBe(
      "Asia/Novosibirsk",
    );
  });

  it("tells the client and staff, but not the one who moved it", async () => {
    const booking = await book(at(5));
    await reschedule(booking.id, at(6));

    const mails: Mail[] = [];
    await notifyBookingMoved(
      api.db,
      booking.id,
      { from: at(5), movedById: client.user.id },
      async (mail) => {
        mails.push(mail);
      },
    );
    expect(mails.map((m) => [m.template, m.to[0]])).toEqual([
      ["booking-notice", "ivan@move.test"],
      ["staff-booking", "anna@move.test"],
      ["staff-booking", "olga@move.test"],
    ]);
    expect(mails[0]?.subject).toBe("Запись перенесена: Анна Иванова");
    expect(mails[0]?.props).toMatchObject({
      notice: "moved",
      movedBy: "client",
    });
    expect(mails[1]?.subject).toStartWith("Запись перенесена: Иван,");
    expect(mails[1]?.props).toMatchObject({
      notice: "moved",
      movedBy: "client",
    });

    mails.length = 0;
    await notifyBookingMoved(
      api.db,
      booking.id,
      { from: at(5), movedById: owner.user.id },
      async (mail) => {
        mails.push(mail);
      },
    );
    expect(mails.map((m) => m.to[0])).toEqual([
      "ivan@move.test",
      "olga@move.test",
    ]);
    expect(mails[0]?.props).toMatchObject({ movedBy: "specialist" });
    expect(mails[1]?.props).toMatchObject({ movedBy: "staff" });
  });

  it("tells only staff about a guest booked by phone", async () => {
    const free = await insertBooking(3 * DAY, {
      kind: "free",
      memberId: null,
      guestName: "Мария",
      guestPhone: "+79001112233",
    });
    const mails: Mail[] = [];
    await notifyBookingMoved(
      api.db,
      free.id,
      { from: at(5), movedById: admin.user.id },
      async (mail) => {
        mails.push(mail);
      },
    );
    expect(mails.map((m) => [m.template, m.to[0]])).toEqual([
      ["staff-booking", "anna@move.test"],
    ]);
  });
});

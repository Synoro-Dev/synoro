import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import {
  AccountDeletion,
  and,
  Booking,
  CreditEntry,
  eq,
  isNotNull,
  PracticeMember,
  StandingTime,
  Subscription,
} from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";

import { createSession, setupTestApi } from "../../../test/helpers";
import { releaseExpiredHolds } from "../../lib/bookings";
import { holdsAtLimit } from "../../lib/guests";
import {
  extendStanding,
  handleStandingCron,
  runStandingHorizon,
  settleStandingHolds,
  standingHoldUntil,
  standingOccurrences,
} from "../../lib/standing";
import { availabilityRouter } from "../availability";
import { bookingRouter } from "../booking";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { standingRouter } from ".";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;

/** The first Monday, 10:00 Moscow time, at least a day and a half from now. */
function firstMonday(extraWeeks = 0) {
  const at = new Date(Date.now() + 36 * HOUR);
  at.setUTCHours(7, 0, 0, 0);
  while (at.getUTCDay() !== 1) at.setUTCDate(at.getUTCDate() + 1);
  return new Date(at.getTime() + extraWeeks * 7 * DAY);
}

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  const titles = () =>
    sent.map((m) => (m.props as unknown as { title: string }).title);
  return { sent, deliver, titles };
}

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

const bookingsOf = (standingId: string) =>
  api.db.query.Booking.findMany({
    where: eq(Booking.standingId, standingId),
    orderBy: (b, { asc }) => asc(b.startsAt),
  });

const standingOf = (id: string) =>
  api.db.query.StandingTime.findFirst({ where: eq(StandingTime.id, id) });

/** A standing time inserted directly, for the cron to work on. */
async function insertStanding(memberId: string, startsAt: Date) {
  const [row] = await api.db
    .insert(StandingTime)
    .values({
      practiceId,
      memberId,
      startsAt,
      intervalWeeks: 1,
      createdById: owner.user.id,
    })
    .returning();
  if (!row) throw new Error("no standing time");
  return row;
}

function pin(session: Session, startsAt: Date, intervalWeeks: 1 | 2 = 1) {
  return call(
    standingRouter.create,
    { practiceId, startsAt, intervalWeeks },
    { context: api.context(session) },
  );
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-standing", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  // Mondays, 10:00–13:00 Moscow time: 07:00Z, 08:00Z and 09:00Z.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );
});
afterAll(async () => {
  if (api) await api.close();
});

describe("standingOccurrences", () => {
  const anchor = new Date("2030-01-07T07:00:00Z");

  it("lists every week after `after`, up to and including `until`", () => {
    const dates = standingOccurrences(
      { startsAt: anchor, intervalWeeks: 1 },
      "Europe/Moscow",
      new Date("2030-01-01T00:00:00Z"),
      new Date("2030-02-04T07:00:00Z"),
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2030-01-07",
      "2030-01-14",
      "2030-01-21",
      "2030-01-28",
      "2030-02-04",
    ]);
  });

  it("starts after the given moment and steps two weeks", () => {
    const dates = standingOccurrences(
      { startsAt: anchor, intervalWeeks: 2 },
      "Europe/Moscow",
      anchor,
      new Date("2030-02-28T00:00:00Z"),
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2030-01-21",
      "2030-02-04",
      "2030-02-18",
    ]);
  });

  it("keeps the local time across a daylight saving change", () => {
    const dates = standingOccurrences(
      { startsAt: new Date("2030-03-25T09:00:00Z"), intervalWeeks: 1 },
      "Europe/Berlin",
      new Date("2030-03-24T00:00:00Z"),
      new Date("2030-04-09T00:00:00Z"),
    );
    // 10:00 in Berlin: 09:00Z in winter, 08:00Z after 31 March.
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2030-03-25T09:00:00.000Z",
      "2030-04-01T08:00:00.000Z",
      "2030-04-08T08:00:00.000Z",
    ]);
  });

  it("holds an unfunded date until 48 hours before it", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const hold = standingHoldUntil(new Date("2030-01-20T07:00:00Z"), now);
    expect(hold.toISOString()).toBe("2030-01-18T07:00:00.000Z");
    // Too close: at least 12 hours from now, never past the start.
    expect(
      standingHoldUntil(new Date("2030-01-01T20:00:00Z"), now).toISOString(),
    ).toBe("2030-01-01T12:00:00.000Z");
    expect(
      standingHoldUntil(new Date("2030-01-01T05:00:00Z"), now).toISOString(),
    ).toBe("2030-01-01T05:00:00.000Z");
  });
});

describe("standing.create", () => {
  it("books the first date and the next four weeks from the balance", async () => {
    const { session, memberId } = await newClient(10);
    const start = firstMonday();
    const result = await pin(session, start);

    const bookings = await bookingsOf(result.standingId);
    const expected = standingOccurrences(
      { startsAt: start, intervalWeeks: 1 },
      "Europe/Moscow",
      new Date(),
      new Date(Date.now() + 28 * DAY),
    );
    expect(bookings.map((b) => b.startsAt.getTime())).toEqual(
      expected.map((d) => d.getTime()),
    );
    expect(bookings.length).toBeGreaterThanOrEqual(3);
    // Every one confirmed, one credit each, marked by its own occurrence.
    expect(
      bookings.every(
        (b) =>
          b.status === "active" &&
          b.holdUntil === null &&
          b.credits === 1 &&
          b.standingSlot?.getTime() === b.startsAt.getTime(),
      ),
    ).toBe(true);
    expect(await balance(memberId)).toBe(10 - bookings.length);
    const entries = await api.db.query.CreditEntry.findMany({
      where: and(
        eq(CreditEntry.memberId, memberId),
        eq(CreditEntry.reason, "booking"),
      ),
    });
    expect(entries).toHaveLength(bookings.length);

    const mine = await call(standingRouter.mine, undefined, {
      context: api.context(session),
    });
    expect(mine).toMatchObject([
      {
        id: result.standingId,
        paused: false,
        unpaid: 0,
        nextAt: start,
        intervalWeeks: 1,
      },
    ]);
  });

  it("holds the dates the balance does not cover, and keeps the first firm", async () => {
    const { session, memberId } = await newClient(2);
    // 11:00 Moscow time: apart from the first test's 10:00 dates.
    const start = new Date(firstMonday().getTime() + HOUR);
    const result = await pin(session, start);

    const bookings = await bookingsOf(result.standingId);
    const firm = bookings.filter((b) => b.holdUntil === null);
    const held = bookings.filter((b) => b.holdUntil !== null);
    expect(firm).toHaveLength(2);
    expect(held.length).toBeGreaterThanOrEqual(1);
    expect(await balance(memberId)).toBe(0);
    // A hold names its deadline and spends nothing.
    for (const b of held) {
      expect(b.holdUntil?.getTime()).toBeLessThanOrEqual(b.startsAt.getTime());
    }
    expect(result.held).toBe(held.length);

    const mine = await call(standingRouter.mine, undefined, {
      context: api.context(session),
    });
    expect(mine[0]?.unpaid).toBe(held.length);
  });

  it("needs a credit for the first date", async () => {
    const { session } = await newClient(0);
    await expect(pin(session, firstMonday(20))).rejects.toMatchObject({
      code: "NO_CREDITS",
    });
  });

  it("refuses a date off the schedule or taken", async () => {
    const { session } = await newClient(5);
    // A Tuesday is not in the schedule.
    await expect(
      pin(session, new Date(firstMonday(30).getTime() + DAY)),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });

    const other = await newClient(5);
    await pin(other.session, firstMonday(31));
    await expect(pin(session, firstMonday(31))).rejects.toMatchObject({
      code: "SLOT_UNAVAILABLE",
    });
  });

  it("is a «Про» feature", async () => {
    const lapsed = await createSession(api.db, { name: "Борис" });
    const other = await call(
      practiceRouter.create,
      { name: "Борис", slug: "boris-standing", profession: "coach" },
      { context: api.context(lapsed) },
    );
    await api.db
      .update(Subscription)
      .set({ trialEndsAt: new Date("2020-01-01T00:00:00Z"), paidUntil: null })
      .where(eq(Subscription.userId, lapsed.user.id));
    const session = await createSession(api.db);
    await call(
      practiceRouter.join,
      { practiceId: other.id },
      { context: api.context(session) },
    );
    await expect(
      call(
        standingRouter.create,
        {
          practiceId: other.id,
          startsAt: firstMonday(),
          intervalWeeks: 1,
        },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "PRO_REQUIRED" });
    expect(
      await call(
        standingRouter.offer,
        { practiceId: other.id },
        { context: api.context() },
      ),
    ).toEqual({ enabled: false });
    expect(
      await call(
        standingRouter.offer,
        { practiceId },
        { context: api.context() },
      ),
    ).toEqual({ enabled: true });
  });
});

describe("the daily run", () => {
  it("makes the dates a moving horizon reaches, once each", async () => {
    const { memberId } = await newClient(20);
    const standing = await insertStanding(memberId, firstMonday(40));
    const now = new Date(firstMonday(40).getTime() - 13 * DAY);
    const mail = recorder();

    const first = await extendStanding(api.db, standing, {
      now,
      deliver: mail.deliver,
    });
    expect(first.confirmed).toHaveLength(3);
    // The same run again makes nothing: every date is already there.
    const again = await extendStanding(api.db, standing, {
      now,
      deliver: mail.deliver,
    });
    expect(again.confirmed).toHaveLength(0);

    // A week later the horizon reaches one more Monday.
    const later = await extendStanding(api.db, standing, {
      now: new Date(now.getTime() + 7 * DAY),
      deliver: mail.deliver,
    });
    expect(later.confirmed).toHaveLength(1);
    expect(await balance(memberId)).toBe(16);
  });

  it("holds the rest and tells the client once when the package runs out", async () => {
    const { memberId } = await newClient(1);
    const standing = await insertStanding(memberId, firstMonday(50));
    const now = new Date(firstMonday(50).getTime() - 13 * DAY);
    const mail = recorder();

    const made = await extendStanding(api.db, standing, {
      now,
      deliver: mail.deliver,
    });
    expect(made.confirmed).toHaveLength(1);
    expect(made.held).toHaveLength(2);
    expect(mail.titles()).toEqual(["Пакет закончился: Анна Иванова"]);
    const [message] = mail.sent;
    expect(JSON.stringify(message?.props)).toContain("?pay=1");

    // The next run: nothing new to hold, nothing more to say.
    await extendStanding(api.db, standing, { now, deliver: mail.deliver });
    expect(mail.sent).toHaveLength(1);
  });

  it("pays the held dates, earliest first, when money arrives", async () => {
    const { memberId } = await newClient(1);
    const standing = await insertStanding(memberId, firstMonday(60));
    const now = new Date(firstMonday(60).getTime() - 13 * DAY);
    await extendStanding(api.db, standing, {
      now,
      deliver: recorder().deliver,
    });
    const before = await bookingsOf(standing.id);
    expect(before.filter((b) => b.holdUntil !== null)).toHaveLength(2);

    // The specialist records one paid package credit: one held date is paid.
    await call(
      creditRouter.grant,
      { practiceId, memberId, delta: 1 },
      { context: api.context(owner) },
    );
    const after = await bookingsOf(standing.id);
    expect(after.map((b) => b.holdUntil === null)).toEqual([true, true, false]);
    expect(await balance(memberId)).toBe(0);
    const entries = await api.db.query.CreditEntry.findMany({
      where: and(
        eq(CreditEntry.memberId, memberId),
        eq(CreditEntry.reason, "booking"),
        isNotNull(CreditEntry.bookingId),
      ),
    });
    expect(entries).toHaveLength(2);
  });

  it("pauses when a hold runs out unpaid, lets the held dates go and says so once", async () => {
    const { session, memberId } = await newClient(1);
    const standing = await insertStanding(memberId, firstMonday(70));
    const now = new Date(firstMonday(70).getTime() - 13 * DAY);
    await extendStanding(api.db, standing, {
      now,
      deliver: recorder().deliver,
    });
    const held = (await bookingsOf(standing.id)).filter(
      (b) => b.holdUntil !== null,
    );
    expect(held).toHaveLength(2);
    await api.db
      .update(Booking)
      .set({ holdUntil: new Date(Date.now() - 1000) })
      .where(eq(Booking.id, held[0]?.id ?? ""));

    await releaseExpiredHolds(api.db, practiceId);
    expect((await standingOf(standing.id))?.pausedAt).toBeInstanceOf(Date);
    const after = await bookingsOf(standing.id);
    // The confirmed date stays; both held dates are let go, slot free again.
    expect(after.filter((b) => b.status === "active")).toHaveLength(1);
    const released = after.filter((b) => b.cancelReason === "hold_expired");
    expect(released).toHaveLength(2);
    expect(released.every((b) => b.standingSlot === null)).toBe(true);

    // A paused standing time makes nothing, and the client is told once.
    const mail = recorder();
    const run = await runStandingHorizon(api.db, { deliver: mail.deliver });
    expect(run.noticed).toBeGreaterThanOrEqual(1);
    expect(mail.titles()).toContain("Постоянное время на паузе: Анна Иванова");
    expect((await bookingsOf(standing.id)).length).toBe(after.length);
    const again = recorder();
    await runStandingHorizon(api.db, { deliver: again.deliver });
    expect(again.titles()).not.toContain(
      "Постоянное время на паузе: Анна Иванова",
    );

    // Resuming after paying brings the released dates back.
    await call(
      creditRouter.grant,
      { practiceId, memberId, delta: 5 },
      { context: api.context(owner) },
    );
    const resumed = await call(
      standingRouter.resume,
      { standingId: standing.id },
      { context: api.context(session) },
    );
    // The standing time is months away: the real horizon makes nothing yet…
    expect(resumed).toEqual({ confirmed: 0, held: 0 });
    const live = await standingOf(standing.id);
    expect(live?.pausedAt).toBeNull();
    // …but with the horizon at it, the two released dates come back.
    if (!live) throw new Error("no standing time");
    const back = await extendStanding(api.db, live, { now });
    expect(back.confirmed).toHaveLength(2);
    await expect(
      call(
        standingRouter.resume,
        { standingId: standing.id },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "NOT_PAUSED" });
  });

  it("does not make a date again once the client cancelled it", async () => {
    const { session, memberId } = await newClient(10);
    const standing = await insertStanding(memberId, firstMonday(80));
    const now = new Date(firstMonday(80).getTime() - 13 * DAY);
    await extendStanding(api.db, standing, { now });
    const [first, second] = await bookingsOf(standing.id);
    await call(
      bookingRouter.cancel,
      { bookingId: second?.id ?? "" },
      { context: api.context(session) },
    );

    const made = await extendStanding(api.db, standing, { now });
    expect(made.confirmed).toHaveLength(0);
    const all = await bookingsOf(standing.id);
    expect(all.filter((b) => b.status === "cancelled")).toHaveLength(1);
    expect(first?.status).toBe("active");
    // The cancelled date went back to the balance, and stays cancelled.
    expect(await balance(memberId)).toBe(8);
  });

  it("leaves a standing time alone once the owner's «Про» has run out", async () => {
    const lapsed = await createSession(api.db, { name: "Вера" });
    const other = await call(
      practiceRouter.create,
      { name: "Вера", slug: "vera-standing", profession: "coach" },
      { context: api.context(lapsed) },
    );
    await call(
      availabilityRouter.replace,
      {
        practiceId: other.id,
        rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }],
      },
      { context: api.context(lapsed) },
    );
    const session = await createSession(api.db);
    const member = await call(
      practiceRouter.join,
      { practiceId: other.id },
      { context: api.context(session) },
    );
    await call(
      creditRouter.grant,
      { practiceId: other.id, memberId: member.id, delta: 5 },
      { context: api.context(lapsed) },
    );
    const [standing] = await api.db
      .insert(StandingTime)
      .values({
        practiceId: other.id,
        memberId: member.id,
        startsAt: firstMonday(90),
        intervalWeeks: 1,
      })
      .returning();
    if (!standing) throw new Error("no standing time");
    await api.db
      .update(Subscription)
      .set({ trialEndsAt: new Date("2020-01-01T00:00:00Z"), paidUntil: null })
      .where(eq(Subscription.userId, lapsed.user.id));

    const made = await extendStanding(api.db, standing, {
      now: new Date(firstMonday(90).getTime() - 13 * DAY),
    });
    expect(made.confirmed).toHaveLength(0);
    expect(made.held).toHaveLength(0);
  });
});

describe("standing.end", () => {
  it("cancels what the client may cancel with the credit back, and stops the cron", async () => {
    const { session, memberId } = await newClient(10);
    const standing = await insertStanding(memberId, firstMonday(100));
    const now = new Date(firstMonday(100).getTime() - 13 * DAY);
    await extendStanding(api.db, standing, { now });
    const count = (await bookingsOf(standing.id)).length;
    expect(count).toBe(3);
    expect(await balance(memberId)).toBe(10 - count);

    const ended = await call(
      standingRouter.end,
      { standingId: standing.id },
      { context: api.context(session) },
    );
    expect(ended).toMatchObject({ cancelled: count, refunded: count, kept: 0 });
    expect(await balance(memberId)).toBe(10);
    expect((await standingOf(standing.id))?.endedAt).toBeInstanceOf(Date);
    expect(
      await call(standingRouter.mine, undefined, {
        context: api.context(session),
      }),
    ).toEqual([]);

    // Ended: the cron makes nothing more.
    const ended2 = await standingOf(standing.id);
    if (!ended2) throw new Error("no standing time");
    expect(
      (await extendStanding(api.db, ended2, { now })).confirmed,
    ).toHaveLength(0);
  });

  it("lets only the client or the staff of the practice end it", async () => {
    const { session } = await newClient(5);
    const result = await pin(session, firstMonday(110));
    const stranger = await newClient(0);
    await expect(
      call(
        standingRouter.end,
        { standingId: result.standingId },
        { context: api.context(stranger.session) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await call(
      standingRouter.end,
      { standingId: result.standingId, refund: false },
      { context: api.context(owner) },
    );
    expect((await standingOf(result.standingId))?.endedAt).toBeInstanceOf(Date);
  });
});

describe("the daily endpoint", () => {
  const post = (authorization?: string) =>
    handleStandingCron(
      new Request("http://localhost/api/cron/standing", {
        method: "POST",
        headers: authorization ? { authorization } : {},
      }),
      api.db,
    );

  it("refuses a call without the shared secret", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("Bearer wrong-secret-0123456789")).status).toBe(401);
  });

  it("runs the horizon for the worker that holds it", async () => {
    const response = await post("Bearer test-cron-secret-0123456789");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      standingTimes: expect.any(Number),
      made: expect.any(Number),
      noticed: expect.any(Number),
    });
  });
});

describe("review fixes", () => {
  it("does not count dates held for a standing time as the visitor's holds", async () => {
    const { memberId } = await newClient(0);
    const standing = await insertStanding(memberId, firstMonday(120));
    const now = new Date(firstMonday(120).getTime() - 13 * DAY);
    const made = await extendStanding(api.db, standing, {
      now,
      deliver: recorder().deliver,
    });
    expect(made.held.length).toBeGreaterThanOrEqual(2);
    expect(await holdsAtLimit(api.db, memberId)).toBe(false);
  });

  it("takes every unpaid hold with the standing time, even a late one", async () => {
    const { session, memberId } = await newClient(0);
    const standing = await insertStanding(memberId, firstMonday(130));
    // A held date ten hours away: inside the cancellation deadline.
    const startsAt = new Date(Date.now() + 10 * HOUR);
    const [held] = await api.db
      .insert(Booking)
      .values({
        practiceId,
        kind: "consultation",
        credits: 1,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        memberId,
        standingId: standing.id,
        standingSlot: startsAt,
        holdUntil: new Date(Date.now() + 5 * HOUR),
      })
      .returning();
    if (!held) throw new Error("no booking");

    const ended = await call(
      standingRouter.end,
      { standingId: standing.id },
      { context: api.context(session) },
    );
    expect(ended).toMatchObject({ cancelled: 1, kept: 0 });

    // Money coming in afterwards pays nothing of it.
    await call(
      creditRouter.grant,
      { practiceId, memberId, delta: 3 },
      { context: api.context(owner) },
    );
    const after = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, held.id),
    });
    expect(after?.status).toBe("cancelled");
    expect(await balance(memberId)).toBe(3);
  });

  it("pays no hold of a practice whose owner is leaving", async () => {
    const { memberId } = await newClient(0);
    const standing = await insertStanding(memberId, firstMonday(140));
    const now = new Date(firstMonday(140).getTime() - 13 * DAY);
    await extendStanding(api.db, standing, {
      now,
      deliver: recorder().deliver,
    });
    await api.db.insert(AccountDeletion).values({
      userId: owner.user.id,
      purgeAt: new Date(Date.now() + 30 * DAY),
    });
    await api.db
      .update(PracticeMember)
      .set({ credits: 5 })
      .where(eq(PracticeMember.id, memberId));

    expect(await settleStandingHolds(api.db, memberId)).toEqual([]);
    expect(await balance(memberId)).toBe(5);
    await api.db
      .delete(AccountDeletion)
      .where(eq(AccountDeletion.userId, owner.user.id));
  });
});

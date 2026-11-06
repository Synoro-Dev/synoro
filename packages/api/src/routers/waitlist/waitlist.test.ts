import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq, Service, sql, user, WaitlistEntry } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import { notifyWaitlist } from "@synoro/jobs/waitlist";

import { createSession, setupTestApi } from "../../../test/helpers";
import { toZonedDate } from "../../lib/schedule";
import { availabilityRouter } from "../availability";
import { bookingRouter } from "../booking";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { serviceRouter } from "../service";
import { waitlistRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;
let hourId: string;
let longId: string;

// 2030-01-07 is a Monday; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const at = (day: string, utc: string) => new Date(`${day}T${utc}:00Z`);
const MONDAY = "2030-01-07";

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  return { sent, deliver };
}

const visitor = (email: string) => ({
  name: "Иван Петров",
  phone: "8 (900) 123-45-67",
  email,
});

/** A week from today: `join` only takes dates up to 60 days ahead. */
// The practice's own zone: its date is a day ahead of UTC late in the evening.
const TODAY = toZonedDate(new Date(), "Europe/Moscow");
const inDays = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const wish = (overrides: Partial<Parameters<typeof join>[0]> = {}) => ({
  fromDate: TODAY,
  toDate: inDays(7),
  fromMinute: null,
  toMinute: null,
  ...overrides,
});

function join(
  input: {
    fromDate: string;
    toDate: string;
    fromMinute: number | null;
    toMinute: number | null;
    serviceId?: string;
    name?: string;
    phone?: string;
    email?: string;
  },
  session: Session | null = null,
) {
  return call(
    waitlistRouter.join,
    {
      practiceId,
      ...visitor(input.email ?? "ivan@visitor.test"),
      ...input,
    },
    { context: api.context(session) },
  );
}

/** An open wish of a new account, inserted directly. */
async function waiting(
  overrides: Partial<typeof WaitlistEntry.$inferInsert> = {},
  email = `${crypto.randomUUID()}@wait.test`,
) {
  const session = await createSession(api.db, { email, name: "Ждущий" });
  const [entry] = await api.db
    .insert(WaitlistEntry)
    .values({
      practiceId,
      userId: session.user.id,
      fromDate: MONDAY,
      toDate: "2030-01-13",
      ...overrides,
    })
    .returning();
  if (!entry) throw new Error("no entry");
  return { session, entry };
}

const notifiedAt = async (id: string) =>
  (
    await api.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.id, id),
    })
  )?.notifiedAt ?? null;

const freed = (utc = "07:00", end = "08:00", day = MONDAY) => ({
  practiceId,
  startsAt: at(day, utc),
  endsAt: at(day, end),
});

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-wait", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );
  const first = (
    await call(
      serviceRouter.list,
      { practiceId },
      { context: api.context(owner) },
    )
  ).services[0];
  if (!first) throw new Error("no service");
  hourId = first.id;
  const { services } = await call(
    serviceRouter.save,
    {
      practiceId,
      services: [
        { ...first, active: true },
        { name: "Длинная сессия", minutes: 90, credits: 2, active: true },
      ],
    },
    { context: api.context(owner) },
  );
  const long = services.find((s) => s.name === "Длинная сессия");
  if (!long) throw new Error("no long service");
  longId = long.id;
});
afterAll(async () => {
  if (api) await api.close();
});

describe("waitlist.join", () => {
  it("lets a visitor leave a wish with their contacts", async () => {
    const { id } = await join(wish({ email: "new@visitor.test" }));
    const entry = await api.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.id, id),
    });
    expect(entry).toMatchObject({
      practiceId,
      fromDate: TODAY,
      toDate: inDays(7),
      fromMinute: null,
      notifiedAt: null,
    });
    const account = await api.db.query.user.findFirst({
      where: eq(user.email, "new@visitor.test"),
    });
    expect(account).toMatchObject({
      emailVerified: false,
      phone: "+79001234567",
    });
    expect(entry?.userId).toBe(account?.id);
  });

  it("uses the account of a signed-in client", async () => {
    const client = await createSession(api.db, { name: "Клиент" });
    const { id } = await join(
      wish({ fromMinute: 1080, serviceId: longId }),
      client,
    );
    const entry = await api.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.id, id),
    });
    expect(entry).toMatchObject({
      userId: client.user.id,
      fromMinute: 1080,
      serviceId: longId,
    });

    const mine = await call(
      waitlistRouter.mine,
      { practiceId },
      { context: api.context(client) },
    );
    expect(mine.entries).toEqual([
      expect.objectContaining({ id, service: "Длинная сессия" }),
    ]);

    await call(
      waitlistRouter.leave,
      { entryId: id },
      { context: api.context(client) },
    );
    expect(
      (
        await call(
          waitlistRouter.mine,
          { practiceId },
          { context: api.context(client) },
        )
      ).entries,
    ).toEqual([]);
  });

  it("rejects bad wishes", async () => {
    await expect(
      join(wish({ fromDate: "2030-01-10", toDate: "2030-01-08" })),
    ).rejects.toBeDefined();
    await expect(
      join(wish({ fromMinute: 600, toMinute: 600 })),
    ).rejects.toBeDefined();
    await expect(join(wish({ fromMinute: 615 }))).rejects.toBeDefined();
    await expect(
      join(wish({ fromDate: "2030-01-01", toDate: "2030-04-01" })),
    ).rejects.toBeDefined();
    await expect(
      join(wish({ fromDate: "2020-01-01", toDate: "2020-01-07" })),
    ).rejects.toMatchObject({ code: "DATES_PAST" });
    // The window is 60 days from today, whatever the range's own length.
    await expect(
      join(wish({ fromDate: "2030-01-07", toDate: "2030-01-13" })),
    ).rejects.toMatchObject({ code: "DATES_TOO_FAR" });
    await expect(
      join(wish({ fromDate: inDays(55), toDate: inDays(61) })),
    ).rejects.toMatchObject({ code: "DATES_TOO_FAR" });
    await expect(
      join(wish({ serviceId: crypto.randomUUID() })),
    ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
  });

  it("keeps staff out and allows three open wishes a person", async () => {
    await expect(join(wish(), owner)).rejects.toMatchObject({
      code: "STAFF",
    });

    const client = await createSession(api.db);
    for (let i = 0; i < 3; i++) await join(wish(), client);
    await expect(join(wish(), client)).rejects.toMatchObject({
      code: "TOO_MANY",
    });
  });

  it("holds the limit for concurrent requests (PGlite runs them in turn, so this does not test the lock itself)", async () => {
    const client = await createSession(api.db);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => join(wish(), client)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(
      (
        await call(
          waitlistRouter.mine,
          { practiceId },
          { context: api.context(client) },
        )
      ).entries,
    ).toHaveLength(3);
  });

  it("asks the practice's staff to sign in instead of using their email", async () => {
    await expect(join(wish({ email: owner.user.email }))).rejects.toMatchObject(
      { code: "SIGN_IN_REQUIRED" },
    );
  });
});

describe("waitlist.list and leave", () => {
  it("shows open wishes to staff only, who may take them off", async () => {
    const { session, entry } = await waiting();
    const asClient = call(
      waitlistRouter.list,
      { practiceId },
      { context: api.context(session) },
    );
    await expect(asClient).rejects.toMatchObject({ code: "FORBIDDEN" });

    const list = await call(
      waitlistRouter.list,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(list.entries.map((e) => e.id)).toContain(entry.id);
    expect(list.entries.find((e) => e.id === entry.id)).toMatchObject({
      name: "Ждущий",
    });

    // Someone else's wish is not theirs to remove.
    const stranger = await createSession(api.db);
    await expect(
      call(
        waitlistRouter.leave,
        { entryId: entry.id },
        { context: api.context(stranger) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call(
      waitlistRouter.leave,
      { entryId: entry.id },
      { context: api.context(owner) },
    );
    expect(await notifiedAt(entry.id)).toBeNull();
    expect(
      await api.db.query.WaitlistEntry.findFirst({
        where: eq(WaitlistEntry.id, entry.id),
      }),
    ).toBeUndefined();
  });
});

describe("notifyWaitlist", () => {
  it("tells a fitting wish once, with a link to the booking page", async () => {
    const { entry } = await waiting({ fromMinute: 540, toMinute: 780 });
    const { sent, deliver } = recorder();

    expect(await notifyWaitlist(api.db, freed(), deliver)).toBeGreaterThan(0);
    const mail = sent.find((m) => m.to[0]?.endsWith("@wait.test"));
    expect(mail).toMatchObject({
      template: "waitlist-notice",
      subject: "Освободилось время: Анна Иванова",
    });
    const props = (mail?.props ?? {}) as { bookingUrl?: string; when?: string };
    expect(props.bookingUrl).toContain("/anna-wait");
    expect(props.when).toContain("10:00");
    expect(await notifiedAt(entry.id)).toBeInstanceOf(Date);

    // The next freed time doesn't tell the same wish again.
    const again = recorder();
    await notifyWaitlist(api.db, freed("08:00", "09:00"), again.deliver);
    expect(again.sent.some((m) => m.to[0] === mail?.to[0])).toBe(false);
  });

  it("skips wishes for other days and other hours", async () => {
    const otherDay = await waiting({
      fromDate: "2030-01-14",
      toDate: "2030-01-20",
    });
    const evening = await waiting({ fromMinute: 1080 });
    const morning = await waiting({ toMinute: 600 });
    const { deliver } = recorder();

    await notifyWaitlist(api.db, freed("08:00", "09:00"), deliver); // 11:00–12:00
    expect(await notifiedAt(otherDay.entry.id)).toBeNull();
    expect(await notifiedAt(evening.entry.id)).toBeNull();
    // Wants to be done by 10:00; the freed hour starts at 11:00.
    expect(await notifiedAt(morning.entry.id)).toBeNull();
  });

  it("needs the freed time to be long enough for the wished service", async () => {
    const day = "2030-01-14";
    const long = await waiting({
      fromDate: day,
      toDate: day,
      serviceId: longId,
    });
    const hour = await waiting({
      fromDate: day,
      toDate: day,
      serviceId: hourId,
    });
    const { deliver } = recorder();

    await notifyWaitlist(api.db, freed("07:00", "08:00", day), deliver);
    expect(await notifiedAt(long.entry.id)).toBeNull();
    expect(await notifiedAt(hour.entry.id)).toBeInstanceOf(Date);

    await notifyWaitlist(api.db, freed("07:00", "08:30", day), deliver);
    expect(await notifiedAt(long.entry.id)).toBeInstanceOf(Date);
  });

  it("does not tell anyone about time somebody else has taken", async () => {
    const day = "2030-01-21";
    const client = await createSession(api.db);
    const member = await call(
      practiceRouter.join,
      { practiceId },
      { context: api.context(client) },
    );
    await call(
      creditRouter.grant,
      { practiceId, memberId: member.id, delta: 1 },
      { context: api.context(owner) },
    );
    await call(
      bookingRouter.book,
      { practiceId, startsAt: at(day, "07:00") },
      { context: api.context(client) },
    );
    const waiter = await waiting({ fromDate: day, toDate: day });
    const { sent, deliver } = recorder();

    expect(
      await notifyWaitlist(api.db, freed("07:00", "08:00", day), deliver),
    ).toBe(0);
    expect(sent).toEqual([]);
    expect(await notifiedAt(waiter.entry.id)).toBeNull();
  });

  it("leaves out whoever gave the time up, and past times", async () => {
    const day = "2030-01-28";
    const { session, entry } = await waiting({ fromDate: day, toDate: day });
    const { sent, deliver } = recorder();

    await notifyWaitlist(
      api.db,
      { ...freed("07:00", "08:00", day), exceptUserId: session.user.id },
      deliver,
    );
    expect(sent).toEqual([]);
    expect(await notifiedAt(entry.id)).toBeNull();

    expect(
      await notifyWaitlist(
        api.db,
        freed("07:00", "08:00", "2020-01-06"),
        deliver,
      ),
    ).toBe(0);
  });

  it("tells at most five, the oldest wishes first", async () => {
    const day = "2030-02-04";
    const entries = [];
    for (let i = 0; i < 7; i++) {
      entries.push(
        (
          await waiting({
            fromDate: day,
            toDate: day,
            createdAt: new Date(Date.UTC(2029, 0, 1 + i)),
          })
        ).entry,
      );
    }
    const { sent, deliver } = recorder();

    expect(
      await notifyWaitlist(api.db, freed("07:00", "08:00", day), deliver),
    ).toBe(5);
    expect(sent).toHaveLength(5);
    const told = await Promise.all(entries.map((e) => notifiedAt(e.id)));
    expect(told.map((t) => t !== null)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("cancelling a booking", () => {
  it("tells the waiting list of the time it freed", async () => {
    const day = "2030-02-11";
    const client = await createSession(api.db);
    const member = await call(
      practiceRouter.join,
      { practiceId },
      { context: api.context(client) },
    );
    await call(
      creditRouter.grant,
      { practiceId, memberId: member.id, delta: 1 },
      { context: api.context(owner) },
    );
    const booking = await call(
      bookingRouter.book,
      { practiceId, startsAt: at(day, "07:00") },
      { context: api.context(client) },
    );
    const waiter = await waiting({ fromDate: day, toDate: day });
    expect(await notifiedAt(waiter.entry.id)).toBeNull();

    await call(
      bookingRouter.cancel,
      { bookingId: booking.id },
      { context: api.context(client) },
    );
    expect(await notifiedAt(waiter.entry.id)).toBeInstanceOf(Date);
  });
});

// The default service stays the plain hour: a wish without one follows it.
describe("a wish without a service", () => {
  it("fits the first service's length", async () => {
    const day = "2030-02-18";
    const { entry } = await waiting({ fromDate: day, toDate: day });
    const first = await api.db.query.Service.findFirst({
      where: eq(Service.id, hourId),
    });
    expect(first?.minutes).toBe(60);
    const { deliver } = recorder();
    await notifyWaitlist(api.db, freed("07:00", "08:00", day), deliver);
    expect(await notifiedAt(entry.id)).toBeInstanceOf(Date);
  });
});

describe("notifyWaitlist: where the wish starts, what is still free", () => {
  it("offers the first start inside the freed window that suits the wish", async () => {
    const day = "2030-03-04";
    // 10:00–12:00 freed; the wish is for 11:00 on.
    const { entry } = await waiting({
      fromDate: day,
      toDate: day,
      fromMinute: 660,
    });
    const { sent, deliver } = recorder();

    await notifyWaitlist(api.db, freed("07:00", "09:00", day), deliver);
    expect(await notifiedAt(entry.id)).toBeInstanceOf(Date);
    const props = (sent.at(-1)?.props ?? {}) as { when?: string };
    // Not «10:00»: the hour that fits begins at 11:00.
    expect(props.when).toContain("11:00");
  });

  it("starts a wished hour on the hour, not where the freed time began", async () => {
    const day = "2030-03-11";
    // A 10:30–11:30 intro was cancelled: no whole hour starts on the hour in it.
    const { entry } = await waiting({ fromDate: day, toDate: day });
    const { deliver } = recorder();

    await notifyWaitlist(api.db, freed("07:30", "08:30", day), deliver);
    expect(await notifiedAt(entry.id)).toBeNull();
  });

  it("tells only about the part of a moved booking's old time that is free", async () => {
    const day = "2030-03-18";
    const { services } = await call(
      serviceRouter.list,
      { practiceId },
      { context: api.context(owner) },
    );
    const { services: withShort } = await call(
      serviceRouter.save,
      {
        practiceId,
        services: [
          ...services,
          { name: "Короткая", minutes: 30, credits: 1, active: true },
        ].map((x) => ({ active: true, ...x })),
      },
      { context: api.context(owner) },
    );
    const short = withShort.find((x) => x.name === "Короткая");
    if (!short) throw new Error("no short service");

    // 10:00–11:30 was freed by moving to 10:30–12:00: only 10:00–10:30 is free.
    await api.db.insert(Booking).values({
      practiceId,
      kind: "consultation",
      startsAt: at(day, "07:30"),
      endsAt: at(day, "09:00"),
    });
    const half = await waiting({
      fromDate: day,
      toDate: day,
      serviceId: short.id,
    });
    const hour = await waiting({
      fromDate: day,
      toDate: day,
      serviceId: hourId,
    });
    const { deliver } = recorder();

    await notifyWaitlist(api.db, freed("07:00", "08:30", day), deliver);
    expect(await notifiedAt(half.entry.id)).toBeInstanceOf(Date);
    expect(await notifiedAt(hour.entry.id)).toBeNull();
  });

  it("leaves a wish for a switched-off service open", async () => {
    const day = "2030-03-25";
    const { services } = await call(
      serviceRouter.list,
      { practiceId },
      { context: api.context(owner) },
    );
    const target = services.find((x) => x.name === "Длинная сессия");
    if (!target) throw new Error("no service");
    const { entry } = await waiting({
      fromDate: day,
      toDate: day,
      serviceId: target.id,
    });
    await call(
      serviceRouter.save,
      {
        practiceId,
        services: services.map((x) => ({
          ...x,
          active: x.id === target.id ? false : x.active,
        })),
      },
      { context: api.context(owner) },
    );
    const { sent, deliver } = recorder();

    await notifyWaitlist(api.db, freed("07:00", "09:00", day), deliver);
    expect(sent).toEqual([]);
    expect(await notifiedAt(entry.id)).toBeNull();
  });

  it("finds a fitting wish behind more than a page of ones that don't fit", async () => {
    const day = "2030-04-01";
    const { session: evening } = await waiting({}, "evening@wait.test");
    await api.db.insert(WaitlistEntry).values(
      Array.from({ length: 60 }, (_, i) => ({
        practiceId,
        userId: evening.user.id,
        fromDate: day,
        toDate: day,
        fromMinute: 1080,
        createdAt: new Date(Date.UTC(2028, 0, 1, 0, i)),
      })),
    );
    const { entry } = await waiting({ fromDate: day, toDate: day });
    const { deliver } = recorder();

    await notifyWaitlist(api.db, freed("07:00", "08:00", day), deliver);
    expect(await notifiedAt(entry.id)).toBeInstanceOf(Date);
  });

  it("keeps the wish open when the notice could not be sent", async () => {
    const day = "2030-04-08";
    const { entry } = await waiting({ fromDate: day, toDate: day });

    const told = await notifyWaitlist(
      api.db,
      freed("07:00", "08:00", day),
      async () => {
        throw new Error("mail is down");
      },
    );
    expect(told).toBe(0);
    expect(await notifiedAt(entry.id)).toBeNull();

    // The next freed time reaches it.
    const { deliver } = recorder();
    await notifyWaitlist(api.db, freed("08:00", "09:00", day), deliver);
    expect(await notifiedAt(entry.id)).toBeInstanceOf(Date);
  });
});

describe("waitlist.join: who is asking", () => {
  it("takes a signed-in client by their account, whatever it is named", async () => {
    // Signing up with «a@example.com» names the account «a»: one letter.
    const client = await createSession(api.db, { name: "a" });
    const { id } = await call(
      waitlistRouter.join,
      { practiceId, ...wish(), phone: "+7 900 123-45-67" },
      { context: api.context(client) },
    );
    const entry = await api.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.id, id),
    });
    expect(entry?.userId).toBe(client.user.id);
  });

  it("asks a visitor for a name and an email", async () => {
    await expect(
      call(
        waitlistRouter.join,
        { practiceId, ...wish(), phone: "+7 900 123-45-67" },
        { context: api.context() },
      ),
    ).rejects.toMatchObject({ code: "GUEST_INVALID" });
    await expect(
      call(
        waitlistRouter.join,
        {
          practiceId,
          ...wish(),
          phone: "+7 900 123-45-67",
          name: "Иван Петров",
          email: "not-an-email",
        },
        { context: api.context() },
      ),
    ).rejects.toMatchObject({ code: "GUEST_INVALID" });
  });
});

describe("notifyWaitlist: reading wishes in pages", () => {
  it("doesn't skip wishes right after a page when some on it were claimed", async () => {
    const day = "2030-04-15";
    const base = Date.UTC(2027, 0, 1);
    const fitting = new Set([0, 1, 2, 50, 51]);
    const { session: evening } = await waiting({}, "cursor@wait.test");
    // 60 wishes in a line: five fit the freed hour, the rest want the evening.
    await api.db.insert(WaitlistEntry).values(
      Array.from({ length: 60 }, (_, i) => i)
        .filter((i) => !fitting.has(i))
        .map((i) => ({
          practiceId,
          userId: evening.user.id,
          fromDate: day,
          toDate: day,
          fromMinute: 1080,
          createdAt: new Date(base + i * 60_000),
        })),
    );
    const entries = [];
    for (const i of fitting) {
      entries.push(
        (
          await waiting({
            fromDate: day,
            toDate: day,
            createdAt: new Date(base + i * 60_000),
          })
        ).entry,
      );
    }
    const { deliver } = recorder();

    // Three of the first page are claimed before the next page is read: an
    // offset of 50 would then jump over the wishes standing at 50 and 51.
    expect(
      await notifyWaitlist(api.db, freed("07:00", "08:00", day), deliver),
    ).toBe(5);
    const told = await Promise.all(entries.map((e) => notifiedAt(e.id)));
    expect(told.every((t) => t !== null)).toBe(true);
  });
});

describe("notifyWaitlist: wishes written within one millisecond", () => {
  it("pages past wishes that differ only in microseconds", async () => {
    const day = "2030-04-22";
    const { session: evening } = await waiting({}, "micro@wait.test");
    // 60 wishes for the evening, all inside one millisecond of 2027-02-01.
    await api.db.insert(WaitlistEntry).values(
      Array.from({ length: 60 }, (_, i) => ({
        practiceId,
        userId: evening.user.id,
        fromDate: day,
        toDate: day,
        fromMinute: 1080,
        createdAt: sql`('2027-02-01 00:00:00.000' || lpad(${i + 1}::text, 3, '0') || '+00')::timestamptz`,
      })),
    );
    // One that fits, a few microseconds after all of them.
    const { entry } = await waiting({
      fromDate: day,
      toDate: day,
      createdAt: sql`'2027-02-01 00:00:00.000900+00'::timestamptz`,
    });
    const { deliver } = recorder();

    // Read with a millisecond cursor, the first 50 would come back page after
    // page and the wish behind them would never be reached.
    expect(
      await notifyWaitlist(api.db, freed("07:00", "08:00", day), deliver),
    ).toBe(1);
    expect(await notifiedAt(entry.id)).toBeInstanceOf(Date);
  });
});

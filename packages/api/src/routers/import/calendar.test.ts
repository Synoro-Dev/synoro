import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { call } from "@orpc/server";
import { encryptSecret } from "@synoro/config/secrets";
import {
  Booking,
  eq,
  GoogleCalendarConnection,
  Practice,
  PracticeClient,
  PracticeMember,
} from "@synoro/db";
import { sendBookingReminders } from "@synoro/jobs/booking-video";
import { readEvents } from "@synoro/jobs/data-import";

import { createSession, setupTestApi } from "../../../test/helpers";
import { importRouter } from "./index";

let api: Awaited<ReturnType<typeof setupTestApi>>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  api = await setupTestApi();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await api.close();
});

const NOW = new Date("2026-11-06T12:00:00Z");
const ZONE = "Europe/Moscow";
const bytes = (text: string) => new TextEncoder().encode(text);
const ics = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      ...event.split("\n"),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");

function iso(events: { startsAt: Date }[]) {
  return events.map((event) => event.startsAt.toISOString());
}

describe("reading a calendar", () => {
  it("reads UTC, named zones, floating times and all-day events", () => {
    const events = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20261110T120000Z\nDTEND:20261110T130000Z\nSUMMARY:UTC",
          "UID:2\nDTSTART;TZID=Asia/Novosibirsk:20261110T120000\nDURATION:PT1H30M\nSUMMARY:Зона",
          "UID:3\nDTSTART:20261110T120000\nDTEND:20261110T123000\nSUMMARY:Без зоны",
          "UID:4\nDTSTART;VALUE=DATE:20261112\nSUMMARY:Весь день",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(events.map((event) => event.startsAt.toISOString())).toEqual([
      "2026-11-10T12:00:00.000Z",
      "2026-11-10T05:00:00.000Z",
      "2026-11-10T09:00:00.000Z",
      "2026-11-11T21:00:00.000Z",
    ]);
    expect(events[1]?.endsAt.toISOString()).toBe("2026-11-10T06:30:00.000Z");
    expect(events[3]?.allDay).toBe(true);
  });

  it("falls back to the practice's zone for one it doesn't know", () => {
    const [event] = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART;TZID=Russian Standard Time:20261110T120000\nDTEND;TZID=Russian Standard Time:20261110T130000",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(event?.startsAt.toISOString()).toBe("2026-11-10T09:00:00.000Z");
  });

  it("unfolds long lines and unescapes text", () => {
    const [event] = readEvents(
      bytes(
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261110T120000Z\r\nDTEND:20261110T130000Z\r\nSUMMARY:Анна\\, вторая \r\n встреча\r\nEND:VEVENT\r\nEND:VCALENDAR",
      ),
      ZONE,
      NOW,
    );
    expect(event?.title).toBe("Анна, вторая встреча");
  });

  it("leaves out cancelled events and what isn't an event", () => {
    const events = readEvents(
      bytes(
        ics(
          "UID:1\nSTATUS:CANCELLED\nDTSTART:20261110T120000Z\nDTEND:20261110T130000Z",
          "UID:2\nSUMMARY:Без времени",
          "UID:3\nDTSTART:20261110T120000Z\nDTEND:20261110T110000Z",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(events).toEqual([]);
  });

  it("doesn't let old dates use up the limit, and COUNT counts them", () => {
    // Daily for over four years: only what's ahead comes out.
    const daily = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20220101T100000Z\nDTEND:20220101T110000Z\nRRULE:FREQ=DAILY",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(daily[0]?.startsAt.toISOString()).toBe("2026-11-07T10:00:00.000Z");
    // Seven weekly dates from 6 October: only the last two are still ahead.
    const counted = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20261006T100000Z\nDTEND:20261006T110000Z\nRRULE:FREQ=WEEKLY;COUNT=7",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(iso(counted)).toEqual([
      "2026-11-10T10:00:00.000Z",
      "2026-11-17T10:00:00.000Z",
    ]);
  });

  it("skips months without the day, without counting them", () => {
    const events = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20270131T100000Z\nDTEND:20270131T110000Z\nRRULE:FREQ=MONTHLY;COUNT=3",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(iso(events)).toEqual([
      "2027-01-31T10:00:00.000Z",
      "2027-03-31T10:00:00.000Z",
      "2027-05-31T10:00:00.000Z",
    ]);
  });

  it("gives up on a day that never comes", () => {
    const events = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20270229T100000Z\nDTEND:20270229T110000Z\nRRULE:FREQ=YEARLY;INTERVAL=4",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it("keeps weeks by WKST, Monday when it isn't said", () => {
    const rule = (wkst: string) =>
      readEvents(
        bytes(
          ics(
            `UID:1\nDTSTART:20261109T100000Z\nDTEND:20261109T110000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;COUNT=3${wkst}`,
          ),
        ),
        ZONE,
        NOW,
      );
    // Monday 9 November: its week, from Monday, ends on Sunday the 15th.
    expect(iso(rule(";WKST=MO"))).toEqual([
      "2026-11-09T10:00:00.000Z",
      "2026-11-15T10:00:00.000Z",
      "2026-11-23T10:00:00.000Z",
    ]);
    expect(iso(rule(""))).toEqual(iso(rule(";WKST=MO")));
    // From Sunday, the week's Sunday was the 8th, before the start.
    expect(iso(rule(";WKST=SU"))).toEqual([
      "2026-11-09T10:00:00.000Z",
      "2026-11-22T10:00:00.000Z",
      "2026-11-23T10:00:00.000Z",
    ]);
  });

  it("ends a whole day at local midnight, on a clock change too", () => {
    const [event] = readEvents(
      bytes(ics("UID:1\nDTSTART;VALUE=DATE:20270328\nSUMMARY:День")),
      "Europe/Berlin",
      NOW,
    );
    // In Berlin that Sunday lasts 23 hours.
    expect(event?.startsAt.toISOString()).toBe("2027-03-27T23:00:00.000Z");
    expect(event?.endsAt.toISOString()).toBe("2027-03-28T22:00:00.000Z");
  });

  it("writes out weekly repeats by wall clock, across the DST change", () => {
    const events = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART;TZID=Europe/Berlin:20261020T100000\nDTEND;TZID=Europe/Berlin:20261020T110000\nRRULE:FREQ=WEEKLY;COUNT=3",
        ),
      ),
      ZONE,
      new Date("2026-10-01T00:00:00Z"),
    );
    // 25 October: Berlin moves from UTC+2 to UTC+1, the clock stays at 10:00.
    expect(iso(events)).toEqual([
      "2026-10-20T08:00:00.000Z",
      "2026-10-27T09:00:00.000Z",
      "2026-11-03T09:00:00.000Z",
    ]);
  });

  it("takes BYDAY, INTERVAL, UNTIL and EXDATE", () => {
    const events = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20261109T100000Z\nDTEND:20261109T110000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261202T235959Z\nEXDATE:20261111T100000Z",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(iso(events)).toEqual([
      "2026-11-09T10:00:00.000Z",
      "2026-11-23T10:00:00.000Z",
      "2026-11-25T10:00:00.000Z",
    ]);
  });

  it("moves a single occurrence", () => {
    const events = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20261109T100000Z\nDTEND:20261109T110000Z\nRRULE:FREQ=DAILY;COUNT=2",
          "UID:1\nRECURRENCE-ID:20261110T100000Z\nDTSTART:20261110T150000Z\nDTEND:20261110T160000Z",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(iso(events).sort()).toEqual([
      "2026-11-09T10:00:00.000Z",
      "2026-11-10T15:00:00.000Z",
    ]);
  });

  it("stops an endless rule a year ahead, and flags what it can't read", () => {
    const endless = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20261109T100000Z\nDTEND:20261109T110000Z\nRRULE:FREQ=WEEKLY",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(endless.length).toBeGreaterThan(50);
    expect(endless.length).toBeLessThan(55);

    const fancy = readEvents(
      bytes(
        ics(
          "UID:1\nDTSTART:20261109T100000Z\nDTEND:20261109T110000Z\nRRULE:FREQ=MONTHLY;BYSETPOS=2;BYDAY=MO",
        ),
      ),
      ZONE,
      NOW,
    );
    expect(fancy).toHaveLength(1);
    expect(fancy[0]?.partial).toBe(true);
  });
});

async function makeOwner() {
  const session = await createSession(api.db);
  const [practice] = await api.db
    .insert(Practice)
    .values({
      name: "Практика",
      slug: `p-${crypto.randomUUID().slice(0, 8)}`,
      ownerId: session.user.id,
    })
    .returning();
  if (!practice) throw new Error("no practice");
  await api.db.insert(PracticeMember).values({
    practiceId: practice.id,
    userId: session.user.id,
    role: "owner",
  });
  return { session, practice, context: { context: api.context(session) } };
}

const stamp = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

function event(days: number, title: string, hour = 10) {
  const start = new Date(Date.now() + days * 86_400_000);
  start.setUTCHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  return `UID:${title}-${days}\nDTSTART:${stamp(start)}\nDTEND:${stamp(end)}\nSUMMARY:${title}`;
}

describe("the calendar import", () => {
  async function upload(
    owner: Awaited<ReturnType<typeof makeOwner>>,
    content: string,
  ) {
    const uploaded = await call(
      importRouter.upload,
      {
        practiceId: owner.practice.id,
        file: new File([bytes(content)], "calendar.ics"),
      },
      owner.context,
    );
    if (uploaded.kind !== "calendar") throw new Error("not a calendar");
    return uploaded;
  }

  it("takes only the future, and shows clashes before writing", async () => {
    const owner = await makeOwner();
    await api.db.insert(Booking).values({
      practiceId: owner.practice.id,
      kind: "blocked",
      startsAt: new Date(
        new Date(Date.now() + 3 * 86_400_000).setUTCHours(10, 30, 0, 0),
      ),
      endsAt: new Date(
        new Date(Date.now() + 3 * 86_400_000).setUTCHours(11, 30, 0, 0),
      ),
    });
    const uploaded = await upload(
      owner,
      ics(
        event(-5, "Прошлое"),
        event(2, "Анна"),
        event(3, "Занято"),
        event(4, "Первая", 12),
        event(4, "Вторая", 12),
        "UID:d\nDTSTART;VALUE=DATE:20991231\nSUMMARY:Отпуск",
      ),
    );

    const seen = await call(
      importRouter.previewEvents,
      { batchId: uploaded.id, eventsAs: "bookings" },
      owner.context,
    );
    expect(seen).toMatchObject({ added: 2, past: 1, allDay: 1 });
    expect(seen.conflicts.total).toBe(2);
    expect(seen.conflicts.samples.map((row) => row.title).sort()).toEqual([
      "Вторая",
      "Занято",
    ]);
    const rows = await api.db
      .select()
      .from(Booking)
      .where(eq(Booking.practiceId, owner.practice.id));
    expect(rows).toHaveLength(1);
  });

  it("writes bookings nobody hears about, and undoes them", async () => {
    const owner = await makeOwner();
    const [card] = await api.db
      .insert(PracticeClient)
      .values({
        practiceId: owner.practice.id,
        name: "Анна",
        email: "anna@b.ru",
      })
      .returning();
    const uploaded = await upload(
      owner,
      ics(event(0, "анна", 23), event(5, "Оля")),
    );
    const result = await call(
      importRouter.commit,
      {
        batchId: uploaded.id,
        eventsAs: "bookings",
        duplicates: "skip",
        importNotes: false,
        consent: true,
      },
      owner.context,
    );
    expect(result.status).toBe("applied");
    expect(result.totals).toMatchObject({ added: 2, skipped: 0 });

    const rows = await api.db
      .select()
      .from(Booking)
      .where(eq(Booking.practiceId, owner.practice.id))
      .orderBy(Booking.startsAt);
    expect(rows.map((row) => row.kind)).toEqual([
      "consultation",
      "consultation",
    ]);
    expect(rows[0]?.guestName).toBe("анна");
    expect(rows[0]?.clientId).toBe(card?.id ?? "");
    expect(rows[0]?.memberId).toBeNull();
    expect(rows[1]?.clientId).toBeNull();

    // Within reminder range of a booking made through the cabinet.
    const sent: unknown[] = [];
    await sendBookingReminders(
      api.db,
      async (message: unknown) => void sent.push(message),
      new Date((rows[0]?.startsAt.getTime() ?? 0) - 1_800_000),
    );
    expect(sent).toEqual([]);

    await call(importRouter.undo, { batchId: uploaded.id }, owner.context);
    expect(
      await api.db
        .select()
        .from(Booking)
        .where(eq(Booking.practiceId, owner.practice.id)),
    ).toEqual([]);
    // The card it linked to was there before, and stays.
    expect(
      await api.db.query.PracticeClient.findFirst({
        where: eq(PracticeClient.id, card?.id ?? ""),
      }),
    ).toBeDefined();
  });

  it("can close the time instead, all-day events too", async () => {
    const owner = await makeOwner();
    const uploaded = await upload(
      owner,
      ics(
        event(2, "Врач"),
        "UID:d\nDTSTART;VALUE=DATE:20991231\nSUMMARY:Отпуск",
      ),
    );
    await call(
      importRouter.commit,
      {
        batchId: uploaded.id,
        eventsAs: "blocked",
        duplicates: "skip",
        importNotes: false,
        consent: true,
      },
      owner.context,
    );
    const rows = await api.db
      .select()
      .from(Booking)
      .where(eq(Booking.practiceId, owner.practice.id))
      .orderBy(Booking.startsAt);
    expect(rows.map((row) => [row.kind, row.note])).toEqual([
      ["blocked", "Врач"],
      ["blocked", "Отпуск"],
    ]);
    expect(rows.every((row) => row.guestName === null)).toBe(true);
  });

  it("adds nothing on a second run", async () => {
    const owner = await makeOwner();
    const content = ics(event(2, "Анна"));
    const apply = async () => {
      const uploaded = await upload(owner, content);
      return call(
        importRouter.commit,
        {
          batchId: uploaded.id,
          eventsAs: "bookings",
          duplicates: "skip",
          importNotes: false,
          consent: true,
        },
        owner.context,
      );
    };
    await apply();
    const second = await apply();
    expect(second.totals).toMatchObject({ added: 0, skipped: 1 });
  });
});

describe("from Google", () => {
  async function connect(practiceId: string) {
    await api.db.insert(GoogleCalendarConnection).values({
      practiceId,
      email: "a@gmail.test",
      refreshToken: encryptSecret("refresh"),
      accessToken: encryptSecret("access"),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  it("needs a linked calendar", async () => {
    const owner = await makeOwner();
    await expect(
      call(
        importRouter.fromGoogle,
        { practiceId: owner.practice.id },
        owner.context,
      ),
    ).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });

  it("takes events, but not the ones Synoro put there itself", async () => {
    const owner = await makeOwner();
    await connect(owner.practice.id);
    const at = new Date(Date.now() + 2 * 86_400_000);
    at.setUTCHours(10, 0, 0, 0);
    const later = new Date(at.getTime() + 3_600_000);
    await api.db.insert(Booking).values({
      practiceId: owner.practice.id,
      kind: "blocked",
      startsAt: new Date(at.getTime() + 86_400_000),
      endsAt: new Date(later.getTime() + 86_400_000),
      googleCalendarId: "primary",
      googleEventId: "mirror",
    });
    const item = (id: string, summary: string, extra = {}) => ({
      id,
      summary,
      start: { dateTime: at.toISOString() },
      end: { dateTime: later.toISOString() },
      ...extra,
    });
    globalThis.fetch = mock(async (url: string | URL) => {
      if (String(url).includes("/events?")) {
        return Response.json({
          items: [
            item("mirror", "Наша запись"),
            item("own", "Запись из Google"),
            item("free", "Свободно", { transparency: "transparent" }),
            item("gone", "Отменена", { status: "cancelled" }),
          ],
        });
      }
      return Response.json({ access_token: "t", expires_in: 3600 });
    }) as unknown as typeof fetch;

    const draft = await call(
      importRouter.fromGoogle,
      { practiceId: owner.practice.id },
      owner.context,
    );
    expect(draft.events).toBe(1);
    const seen = await call(
      importRouter.previewEvents,
      { batchId: draft.id, eventsAs: "bookings" },
      owner.context,
    );
    expect(seen.samples.map((row) => row.title)).toEqual(["Запись из Google"]);
  });

  it("closes a whole day from midnight in the practice's zone", () => {
    const [day] = readEvents(
      bytes(
        JSON.stringify({
          events: [
            {
              title: "Отпуск",
              startsAt: "2027-02-10",
              endsAt: "2027-02-11",
              allDay: true,
            },
          ],
        }),
      ),
      ZONE,
      NOW,
    );
    // Midnight in Moscow, not 03:00.
    expect(day?.startsAt.toISOString()).toBe("2027-02-09T21:00:00.000Z");
    expect(day?.endsAt.toISOString()).toBe("2027-02-10T21:00:00.000Z");
  });
});

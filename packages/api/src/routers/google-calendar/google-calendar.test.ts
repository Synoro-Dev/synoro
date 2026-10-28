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
import { Booking, eq, GoogleCalendarConnection } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { finishGoogleConnect } from "../../lib/google-calendar";
import { availabilityRouter } from "../availability";
import { bookingRouter } from "../booking";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { googleCalendarRouter } from ".";

// 2030-01-07 is a Monday; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const MONDAY = "2030-01-07";
const at = (utc: string) => new Date(`${MONDAY}T${utc}:00Z`);
const busyAt = (from: string, to: string) => ({
  start: at(from).toISOString(),
  end: at(to).toISOString(),
});

/** A stand-in for Google's OAuth and Calendar endpoints. */
const google = {
  busy: [] as { start: string; end: string }[],
  down: false,
  events: new Map<string, { calendarId: string; summary: string }>(),
  calls: [] as string[],
  reset() {
    this.busy = [];
    this.down = false;
    this.calls = [];
  },
};

const idToken = [
  "header",
  Buffer.from(JSON.stringify({ email: "anna@gmail.com" })).toString(
    "base64url",
  ),
  "signature",
].join(".");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function fakeGoogle(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method = init?.method ?? "GET";
  google.calls.push(`${method} ${url.host}${url.pathname}`);

  if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
    const body = new URLSearchParams(init?.body as string);
    if (body.get("grant_type") === "authorization_code") {
      return json({
        access_token: "access-1",
        expires_in: 3600,
        refresh_token: "refresh-1",
        scope:
          "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
        id_token: idToken,
      });
    }
    return json({ access_token: "access-2", expires_in: 3600 });
  }
  if (url.host === "oauth2.googleapis.com") return new Response(null);

  if (google.down) return json({ error: { message: "Backend Error" } }, 503);
  const path = url.pathname.replace("/calendar/v3", "");
  if (path === "/freeBusy") {
    return json({ calendars: { primary: { busy: google.busy } } });
  }
  if (path.startsWith("/users/me/calendarList")) {
    return json({
      items: [
        {
          id: "anna@gmail.com",
          summary: "anna@gmail.com",
          primary: true,
          accessRole: "owner",
        },
        { id: "holidays", summary: "Праздники", accessRole: "reader" },
      ],
    });
  }
  const event = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
  if (event && method === "POST") {
    const body = JSON.parse(init?.body as string) as {
      id: string;
      summary: string;
    };
    if (google.events.has(body.id)) return json({}, 409);
    google.events.set(body.id, {
      calendarId: decodeURIComponent(event[1] ?? ""),
      summary: body.summary,
    });
    return json({ id: body.id });
  }
  if (event?.[2] && method === "DELETE") {
    const existed = google.events.delete(event[2]);
    return new Response(null, { status: existed ? 204 : 410 });
  }
  return json({ error: { message: "Not found" } }, 404);
}

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let client: Session;
let practiceId: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = fakeGoogle as typeof fetch;
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  practiceId = (
    await call(
      practiceRouter.create,
      { name: "Анна Иванова", slug: "anna-gcal", profession: "psychologist" },
      { context: api.context(owner) },
    )
  ).id;
  // Monday 10:00–13:00 MSK = 07:00–10:00Z.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );

  client = await createSession(api.db, { name: "Иван" });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(client) },
  );
  await call(
    creditRouter.grant,
    { practiceId, memberId: member.id, delta: 5 },
    { context: api.context(owner) },
  );
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  if (api) await api.close();
});
beforeEach(() => google.reset());

async function slotStarts() {
  const { slots } = await call(
    bookingRouter.slots,
    { practiceId, from: MONDAY, days: 1 },
    { context: api.context() },
  );
  return slots.map((s) => s.startsAt.toISOString());
}

describe("connecting", () => {
  it("lets only the owner start the OAuth flow", async () => {
    await expect(
      call(
        googleCalendarRouter.connect,
        { practiceId },
        { context: api.context(client) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a callback from another signed-in user", async () => {
    const { url } = await call(
      googleCalendarRouter.connect,
      { practiceId },
      { context: api.context(owner) },
    );
    const state = new URL(url).searchParams.get("state");
    const callback = new URL(
      `http://localhost:3000/api/google-calendar/callback?code=c&state=${state}`,
    );
    expect(await finishGoogleConnect(api.db, callback, client.user.id)).toBe(
      "/practices?google=invalid",
    );
    expect(google.calls).toEqual([]);
  });

  it("saves the account with encrypted tokens", async () => {
    const { url } = await call(
      googleCalendarRouter.connect,
      { practiceId },
      { context: api.context(owner) },
    );
    const consent = new URL(url);
    expect(consent.searchParams.get("access_type")).toBe("offline");
    expect(consent.searchParams.get("scope")).toContain("calendar.events");

    const callback = new URL(
      `http://localhost:3000/api/google-calendar/callback?code=c&state=${consent.searchParams.get("state")}`,
    );
    expect(await finishGoogleConnect(api.db, callback, owner.user.id)).toBe(
      `/practices/${practiceId}/schedule?google=connected`,
    );

    const settings = await call(
      googleCalendarRouter.settings,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(settings).toMatchObject({
      available: true,
      canManage: true,
      connection: {
        email: "anna@gmail.com",
        busyCalendarIds: ["primary"],
        eventsCalendarId: "primary",
        exportBookings: true,
        lastError: null,
      },
    });
    const row = await api.db.query.GoogleCalendarConnection.findFirst();
    expect(row?.refreshToken).not.toContain("refresh-1");
  });

  it("lists calendars with the primary one as `primary`", async () => {
    const calendars = await call(
      googleCalendarRouter.calendars,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(calendars.map((c) => [c.id, c.canWrite])).toEqual([
      ["primary", true],
      ["holidays", false],
    ]);
  });
});

describe("busy time", () => {
  it("closes slots that are busy in Google", async () => {
    google.busy = [busyAt("07:00", "07:30")];
    const starts = await slotStarts();
    expect(starts).not.toContain(at("07:00").toISOString());
    expect(starts).toContain(at("08:00").toISOString());
  });

  it("rejects booking a time that is busy in Google", async () => {
    google.busy = [busyAt("07:30", "08:00")];
    await expect(
      call(
        bookingRouter.book,
        { practiceId, startsAt: at("07:00") },
        { context: api.context(client) },
      ),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("keeps taking bookings when Google is down, and says so", async () => {
    google.down = true;
    expect(await slotStarts()).toContain(at("07:00").toISOString());
    const down = await call(
      googleCalendarRouter.settings,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(down.connection?.lastError).toBeTruthy();

    google.down = false;
    await slotStarts();
    const back = await call(
      googleCalendarRouter.settings,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(back.connection?.lastError).toBeNull();
  });

  it("refreshes an expired access token", async () => {
    await api.db
      .update(GoogleCalendarConnection)
      .set({ accessTokenExpiresAt: new Date(0) });
    await slotStarts();
    expect(google.calls).toContain("POST oauth2.googleapis.com/token");
  });
});

describe("bookings in Google", () => {
  it("adds a booking as an event and deletes it on cancel", async () => {
    const booking = await call(
      bookingRouter.book,
      { practiceId, startsAt: at("08:00") },
      { context: api.context(client) },
    );
    const eventId = booking.id.replaceAll("-", "");
    expect(google.events.get(eventId)).toEqual({
      calendarId: "primary",
      summary: "Консультация — Иван",
    });
    const row = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, booking.id),
    });
    expect(row).toMatchObject({
      googleCalendarId: "primary",
      googleEventId: eventId,
    });

    await call(
      bookingRouter.cancel,
      { bookingId: booking.id },
      { context: api.context(client) },
    );
    expect(google.events.has(eventId)).toBe(false);
  });

  it("lets staff book over Google time and shows only the rest", async () => {
    google.busy = [busyAt("07:00", "08:00"), busyAt("09:00", "10:00")];
    const free = await call(
      bookingRouter.bookFree,
      {
        practiceId,
        startsAt: at("09:00"),
        guestName: "Мария",
        guestPhone: "+79001112233",
      },
      { context: api.context(owner) },
    );
    expect(google.events.get(free.id.replaceAll("-", ""))?.summary).toBe(
      "Знакомство — Мария",
    );

    const busy = await call(
      googleCalendarRouter.busy,
      { practiceId, from: MONDAY, days: 1 },
      { context: api.context(owner) },
    );
    expect(busy).toEqual([
      { startsAt: at("07:00"), endsAt: at("08:00") },
      { startsAt: at("09:30"), endsAt: at("10:00") },
    ]);
  });

  it("stops writing events when export is off", async () => {
    await call(
      googleCalendarRouter.update,
      {
        practiceId,
        busyCalendarIds: ["primary"],
        eventsCalendarId: "primary",
        exportBookings: false,
      },
      { context: api.context(owner) },
    );
    const before = google.events.size;
    await call(
      bookingRouter.book,
      { practiceId, startsAt: at("07:00") },
      { context: api.context(client) },
    );
    expect(google.events.size).toBe(before);
  });
});

describe("disconnecting", () => {
  it("revokes access and forgets the account", async () => {
    await call(
      googleCalendarRouter.disconnect,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(google.calls).toContain("POST oauth2.googleapis.com/revoke");
    const settings = await call(
      googleCalendarRouter.settings,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(settings.connection).toBeNull();
  });
});

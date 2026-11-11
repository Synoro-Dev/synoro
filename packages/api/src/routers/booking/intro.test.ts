import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq, PracticeMember, user } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import {
  markRemindersCovered,
  notifyBookingConfirmed,
} from "@synoro/jobs/booking-video";

import { createSession, setupTestApi } from "../../../test/helpers";
import { hashGuestToken } from "../../lib/guests";
import { availabilityRouter } from "../availability";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;

// 2030-01-07 is a Monday; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const MONDAY = "2030-01-07";
const at = (utc: string, day = MONDAY) => new Date(`${day}T${utc}:00Z`);

const visitor = (email: string, phone = "8 (900) 555-00-01") => ({
  name: "Мария Петрова",
  phone,
  email,
});

function bookIntro(
  startsAt: Date,
  options: { guest?: ReturnType<typeof visitor>; session?: Session } = {},
) {
  return call(
    bookingRouter.bookIntro,
    { practiceId, startsAt, guest: options.guest },
    { context: api.context(options.session ?? null) },
  );
}

function setFreeBooking(enabled: boolean, session = owner) {
  return call(
    practiceRouter.setFreeBooking,
    { practiceId, enabled },
    { context: api.context(session) },
  );
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Тренер", slug: "anna-intro", profession: "trainer" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  // Monday 10:00–13:00 MSK.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );
});
afterAll(async () => {
  if (api) await api.close();
});

describe("free intro booked by the visitor", () => {
  it("is off until the owner turns it on, and only the owner can", async () => {
    await expect(
      bookIntro(at("07:00"), { guest: visitor("off@visitor.test") }),
    ).rejects.toMatchObject({ code: "FREE_BOOKING_OFF" });

    const client = await createSession(api.db);
    await call(
      practiceRouter.join,
      { practiceId },
      { context: api.context(client) },
    );
    await expect(setFreeBooking(true, client)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await setFreeBooking(true);
    const page = await call(
      practiceRouter.bySlug,
      { slug: "anna-intro" },
      { context: api.context() },
    );
    expect(page.freeBooking).toBe(true);
  });

  it("books a guest for half an hour, confirmed, with a link", async () => {
    const email = "maria@visitor.test";
    const { token, startsAt, endsAt } = await bookIntro(at("07:30"), {
      guest: visitor(email),
    });
    expect(startsAt).toEqual(at("07:30"));
    expect(endsAt).toEqual(at("08:00"));

    const booking = await api.db.query.Booking.findFirst({
      where: eq(Booking.accessTokenHash, hashGuestToken(token)),
    });
    expect(booking).toMatchObject({
      kind: "free",
      status: "active",
      holdUntil: null,
      guestName: "Мария Петрова",
      guestPhone: "+79005550001",
    });
    // A passive client of the practice, as with a paid online booking.
    const account = await api.db.query.user.findFirst({
      where: eq(user.email, email),
    });
    const member = await api.db.query.PracticeMember.findFirst({
      where: eq(PracticeMember.userId, account?.id ?? ""),
    });
    expect(member).toMatchObject({ role: "client", credits: 0 });
    expect(booking?.memberId).toBe(member?.id ?? "");

    const page = await call(
      bookingRouter.guest,
      { token },
      { context: api.context() },
    );
    expect(page).toMatchObject({
      state: "confirmed",
      kind: "free",
      canCancel: true,
      name: "Мария Петрова",
    });

    // The paid 10:00 hour now overlaps it.
    const { slots } = await call(
      bookingRouter.slots,
      { practiceId, from: MONDAY, days: 1 },
      { context: api.context() },
    );
    expect(slots.map((s) => s.startsAt)).toEqual([at("08:00"), at("09:00")]);
  });

  it("is once per person: by account or by phone", async () => {
    // The same email, another time.
    await expect(
      bookIntro(at("09:00"), { guest: visitor("maria@visitor.test") }),
    ).rejects.toMatchObject({ code: "ALREADY_USED" });
    // Another email, the same phone.
    await expect(
      bookIntro(at("09:00"), { guest: visitor("other@visitor.test") }),
    ).rejects.toMatchObject({ code: "ALREADY_USED" });

    // A guest staff booked by phone counts too.
    await call(
      bookingRouter.bookFree,
      {
        practiceId,
        startsAt: at("09:00"),
        guestName: "Звонил",
        guestPhone: "+79005550002",
      },
      { context: api.context(owner) },
    );
    await expect(
      bookIntro(at("09:30"), {
        guest: visitor("caller@visitor.test", "+7 900 555-00-02"),
      }),
    ).rejects.toMatchObject({ code: "ALREADY_USED" });
  });

  it("can be booked again after it was cancelled, not after a no-show", async () => {
    const guest = visitor("ivan@visitor.test", "+79005550003");
    const first = await bookIntro(at("07:30", "2030-01-14"), { guest });
    await call(
      bookingRouter.cancelGuest,
      { token: first.token },
      { context: api.context() },
    );
    const page = await call(
      bookingRouter.guest,
      { token: first.token },
      { context: api.context() },
    );
    expect(page.state).toBe("cancelled");

    const second = await bookIntro(at("08:00", "2030-01-14"), { guest });
    const booking = await api.db.query.Booking.findFirst({
      where: eq(Booking.accessTokenHash, hashGuestToken(second.token)),
    });
    await api.db
      .update(Booking)
      .set({ status: "cancelled", cancelReason: "no_show" })
      .where(eq(Booking.id, booking?.id ?? ""));
    await expect(
      bookIntro(at("09:00", "2030-01-14"), { guest }),
    ).rejects.toMatchObject({ code: "ALREADY_USED" });
  });

  it("refuses times off the half-hour schedule or already taken", async () => {
    const guest = visitor("slots@visitor.test", "+79005550004");
    await expect(
      bookIntro(at("07:15", "2030-01-21"), { guest }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(
      bookIntro(at("10:00", "2030-01-21"), { guest }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    // Taken by Мария.
    await expect(bookIntro(at("07:30"), { guest })).rejects.toMatchObject({
      code: "SLOT_UNAVAILABLE",
    });
    await expect(bookIntro(at("07:00", "2030-01-21"))).rejects.toMatchObject({
      code: "CONTACTS_REQUIRED",
    });
  });

  it("books a signed-in client as themselves, shown in their cabinet", async () => {
    const session = await createSession(api.db, {
      name: "Олег",
      phone: "+79005550005",
    });
    const { token } = await bookIntro(at("07:00", "2030-01-21"), { session });

    const mine = await call(bookingRouter.mine, undefined, {
      context: api.context(session),
    });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "free", canCancel: true });

    // Cancelled from the cabinet, any time before it starts.
    await call(
      bookingRouter.cancel,
      { bookingId: mine[0]?.id ?? "" },
      { context: api.context(session) },
    );
    const page = await call(
      bookingRouter.guest,
      { token },
      { context: api.context() },
    );
    expect(page.state).toBe("cancelled");

    const noPhone = await createSession(api.db, { phone: null });
    await expect(
      bookIntro(at("07:00", "2030-01-21"), { session: noPhone }),
    ).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    await expect(
      bookIntro(at("07:00", "2030-01-21"), { session: owner }),
    ).rejects.toMatchObject({ code: "STAFF" });
    // Staff emails can't be used without signing in.
    await expect(
      bookIntro(at("07:00", "2030-01-21"), {
        guest: visitor(owner.user.email, "+79005550006"),
      }),
    ).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
  });
});

describe("intro notices", () => {
  it("sends no confirmation; due reminders wait for the link mail", async () => {
    const { token } = await bookIntro(at("07:00", "2030-02-04"), {
      guest: visitor("soon@visitor.test", "+79005550009"),
    });
    const booking = await api.db.query.Booking.findFirst({
      where: eq(Booking.accessTokenHash, hashGuestToken(token)),
    });
    const id = booking?.id ?? "";
    // As if it were booked for two hours from now.
    const soon = Date.now() + 2 * 60 * 60 * 1000;
    await api.db
      .update(Booking)
      .set({
        startsAt: new Date(soon),
        endsAt: new Date(soon + 30 * 60_000),
        reminderDaySentAt: null,
      })
      .where(eq(Booking.id, id));

    const sent: TemplateEmail[] = [];
    await notifyBookingConfirmed(api.db, id, async (message) => {
      sent.push(message);
    });

    // The client gets the link from bookIntro; staff are told here.
    expect(sent.map((m) => m.template)).toEqual(["staff-booking"]);
    const reminders = () =>
      api.db.query.Booking.findFirst({
        where: eq(Booking.id, id),
        columns: { reminderDaySentAt: true, reminderHourSentAt: true },
      });
    // Until the link mail is out, the reminder is still the client's notice.
    expect(await reminders()).toEqual({
      reminderDaySentAt: null,
      reminderHourSentAt: null,
    });

    await markRemindersCovered(api.db, id);
    const after = await reminders();
    expect(after?.reminderDaySentAt).toBeInstanceOf(Date);
    expect(after?.reminderHourSentAt).toBeNull();
  });
});

describe("free windows for staff", () => {
  it("lists free time and starts of both kinds, staff only", async () => {
    const { days, timezone } = await call(
      bookingRouter.windows,
      { practiceId, from: MONDAY, days: 2 },
      { context: api.context(owner) },
    );
    expect(timezone).toBe("Europe/Moscow");
    const [monday, tuesday] = days;
    // 10:30–11:00 Мария, 12:00–12:30 the guest booked by phone.
    expect(monday?.free).toEqual([
      { startsAt: at("07:00"), endsAt: at("07:30") },
      { startsAt: at("08:00"), endsAt: at("09:00") },
      { startsAt: at("09:30"), endsAt: at("10:00") },
    ]);
    expect(monday?.slots.consultation).toEqual([at("08:00")]);
    expect(monday?.slots.free).toEqual([
      at("07:00"),
      at("08:00"),
      at("08:30"),
      at("09:30"),
    ]);
    expect(tuesday).toMatchObject({ working: [], free: [] });

    const client = await createSession(api.db);
    await call(
      practiceRouter.join,
      { practiceId },
      { context: api.context(client) },
    );
    await expect(
      call(
        bookingRouter.windows,
        { practiceId, from: MONDAY, days: 1 },
        { context: api.context(client) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("intro length", () => {
  // Another Monday, 10:00–13:00 MSK = 07:00–10:00Z, nothing booked yet.
  const DAY = "2030-02-04";

  const freeSlots = async () => {
    const { slots } = await call(
      bookingRouter.slots,
      { practiceId, from: DAY, days: 1, kind: "free" },
      { context: api.context() },
    );
    return slots;
  };

  it("is set by the owner to one of the offered lengths", async () => {
    await expect(
      call(
        practiceRouter.setFreeBooking,
        { practiceId, introMinutes: 50 },
        { context: api.context(owner) },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const client = await createSession(api.db);
    await call(
      practiceRouter.join,
      { practiceId },
      { context: api.context(client) },
    );
    await expect(
      call(
        practiceRouter.setFreeBooking,
        { practiceId, introMinutes: 60 },
        { context: api.context(client) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const saved = await call(
      practiceRouter.setFreeBooking,
      { practiceId, introMinutes: 60 },
      { context: api.context(owner) },
    );
    // The switch is left as it was.
    expect(saved).toEqual({ enabled: true, introMinutes: 60 });
    const page = await call(
      practiceRouter.bySlug,
      { slug: "anna-intro" },
      { context: api.context() },
    );
    expect(page).toMatchObject({ freeBooking: true, introMinutes: 60 });
  });

  it("gives intros that length, still starting on the half hour", async () => {
    const slots = await freeSlots();
    expect(slots.map((s) => s.startsAt)).toEqual([
      at("07:00", DAY),
      at("07:30", DAY),
      at("08:00", DAY),
      at("08:30", DAY),
      at("09:00", DAY),
    ]);
    expect(slots[0]?.endsAt).toEqual(at("08:00", DAY));

    const { endsAt } = await bookIntro(at("07:30", DAY), {
      guest: visitor("hour@visitor.test", "+7 900 555-00-07"),
    });
    expect(endsAt).toEqual(at("08:30", DAY));
    expect((await freeSlots()).map((s) => s.startsAt)).toEqual([
      at("08:30", DAY),
      at("09:00", DAY),
    ]);

    const byPhone = await call(
      bookingRouter.bookFree,
      {
        practiceId,
        startsAt: at("09:00", DAY),
        guestName: "Звонил",
        guestPhone: "+79005550008",
      },
      { context: api.context(owner) },
    );
    expect(byPhone.endsAt).toEqual(at("10:00", DAY));

    // An hour from 09:30 would run past the end of the day.
    await expect(
      bookIntro(at("09:30", DAY), {
        guest: visitor("late@visitor.test", "+7 900 555-00-09"),
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("leaves intros already booked as they were", async () => {
    await call(
      practiceRouter.setFreeBooking,
      { practiceId, introMinutes: 30 },
      { context: api.context(owner) },
    );
    const booked = await api.db.query.Booking.findFirst({
      where: eq(Booking.startsAt, at("07:30", DAY)),
    });
    expect(booked?.endsAt).toEqual(at("08:30", DAY));
    expect((await freeSlots()).map((s) => s.startsAt)).toEqual([
      at("07:00", DAY),
      at("08:30", DAY),
    ]);
  });
});

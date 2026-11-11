import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import {
  notifyBookingConfirmed,
  sendBookingReminders,
} from "@synoro/jobs/booking-video";

import { createSession, setupTestApi } from "../../../test/helpers";
import { hashGuestToken } from "../../lib/guests";
import { availabilityRouter } from "../availability";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let client: Session;
let practiceId: string;
let memberId: string;

// 2030-01-07 is a Monday; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const MONDAY_10_MSK = new Date("2030-01-07T07:00:00Z");

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  const props = () =>
    sent.map((m) => m.props as unknown as { notice: string; when: string });
  return { sent, deliver, props };
}

async function insertBooking(
  startsAt: Date,
  clientTimezone: string | null = null,
) {
  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
      memberId,
      clientTimezone,
    })
    .returning();
  if (!booking) throw new Error("no booking");
  return booking;
}

const clearBookings = () =>
  api.db.delete(Booking).where(eq(Booking.practiceId, practiceId));

const visitor = (n: number) => ({
  name: "Мария Петрова",
  phone: `8 (900) 555-00-${String(n).padStart(2, "0")}`,
  email: `maria${n}@tz.test`,
});

function bookIntro(n: number, timezone?: string) {
  return call(
    bookingRouter.bookIntro,
    {
      practiceId,
      // Half-hour apart, inside Monday 10:00–13:00 MSK.
      startsAt: new Date(MONDAY_10_MSK.getTime() + n * 30 * MINUTE),
      guest: visitor(n),
      timezone,
    },
    { context: api.context() },
  );
}

async function clientTimezoneOf(token: string) {
  const row = await api.db.query.Booking.findFirst({
    where: eq(Booking.accessTokenHash, hashGuestToken(token)),
    columns: { clientTimezone: true },
  });
  return row?.clientTimezone;
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-tz", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  // Monday 10:00–13:00 MSK, and the free intro open to visitors.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );
  await call(
    practiceRouter.setFreeBooking,
    { practiceId, enabled: true },
    { context: api.context(owner) },
  );
  client = await createSession(api.db, {
    name: "Иван",
    email: "ivan@tz.test",
  });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(client) },
  );
  memberId = member.id;
});
afterAll(async () => {
  if (api) await api.close();
});

describe("the zone a client books from", () => {
  it("is kept with the booking", async () => {
    const { token } = await bookIntro(0, "Asia/Novosibirsk");
    expect(await clientTimezoneOf(token)).toBe("Asia/Novosibirsk");
  });

  it("is given back on the visitor's booking page", async () => {
    const { token } = await bookIntro(4, "Asia/Vladivostok");
    const page = await call(
      bookingRouter.guest,
      { token },
      { context: api.context() },
    );
    expect(page.clientTimezone).toBe("Asia/Vladivostok");
  });

  it("lets the slots be asked for 35 days, for the zone padding", async () => {
    const { slots } = await call(
      bookingRouter.slots,
      { practiceId, from: "2030-01-05", days: 35 },
      { context: api.context() },
    );
    expect(slots.length).toBeGreaterThan(0);
  });

  it("is written canonically, and left out when unknown", async () => {
    const { token: lower } = await bookIntro(1, "europe/berlin");
    expect(await clientTimezoneOf(lower)).toBe("Europe/Berlin");

    // A zone this runtime doesn't know must not stop the booking.
    const { token: unknown } = await bookIntro(2, "Mars/Olympus");
    expect(await clientTimezoneOf(unknown)).toBeNull();

    const { token: none } = await bookIntro(3);
    expect(await clientTimezoneOf(none)).toBeNull();
  });
});

describe("mails to the client", () => {
  it("write the time in the client's zone, naming it", async () => {
    await clearBookings();
    const booking = await insertBooking(MONDAY_10_MSK, "Asia/Novosibirsk");
    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);
    const [notice] = mail.props();
    expect(notice?.notice).toBe("confirmed");
    // 07:00Z is 14:00 in Novosibirsk (UTC+7).
    expect(notice?.when).toContain("14:00");
    expect(notice?.when).toContain("(Новосибирск)");
  });

  it("name the practice's zone when the client's is not known", async () => {
    await clearBookings();
    const booking = await insertBooking(MONDAY_10_MSK);
    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);
    const [notice] = mail.props();
    expect(notice?.when).toContain("10:00");
    expect(notice?.when).toContain("(Москва)");
  });

  it("send the day reminder in the client's daytime, not the practice's", async () => {
    await clearBookings();
    // 13:00Z: afternoon in Moscow (16:00), late night in Vladivostok (23:00).
    const now = new Date("2030-03-12T13:00:00Z");
    const far = await insertBooking(
      new Date(now.getTime() + 14 * HOUR),
      "Asia/Vladivostok",
    );
    const home = await insertBooking(new Date(now.getTime() + 12 * HOUR));
    const mail = recorder();
    await sendBookingReminders(api.db, mail.deliver, now);
    expect(mail.props().map((m) => m.notice)).toEqual(["reminder-day"]);

    const sentAt = async (id: string) =>
      (
        await api.db.query.Booking.findFirst({
          where: eq(Booking.id, id),
          columns: { reminderDaySentAt: true },
        })
      )?.reminderDaySentAt;
    expect(await sentAt(home.id)).toBeInstanceOf(Date);
    expect(await sentAt(far.id)).toBeNull();

    // 23:00Z is 09:00 in Vladivostok: the night is over there.
    await sendBookingReminders(
      api.db,
      mail.deliver,
      new Date("2030-03-12T23:00:00Z"),
    );
    expect(mail.props().map((m) => m.notice)).toEqual([
      "reminder-day",
      "reminder-day",
    ]);
    expect(await sentAt(far.id)).toBeInstanceOf(Date);
  });
});

describe("practice.setTimezone", () => {
  const set = (timezone: string, session = owner) =>
    call(
      practiceRouter.setTimezone,
      { practiceId, timezone },
      { context: api.context(session) },
    );
  const current = async () =>
    (
      await call(
        practiceRouter.get,
        { practiceId },
        { context: api.context(owner) },
      )
    ).timezone;

  it("is the owner's to change", async () => {
    await expect(set("Asia/Novosibirsk", client)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await current()).toBe("Europe/Moscow");

    expect(await set("asia/novosibirsk")).toEqual({
      timezone: "Asia/Novosibirsk",
    });
    expect(await current()).toBe("Asia/Novosibirsk");
    await set("Europe/Moscow");
  });

  it("rejects a zone nobody knows", async () => {
    await expect(set("Mars/Olympus")).rejects.toMatchObject({
      code: "INVALID_TIMEZONE",
    });
    expect(await current()).toBe("Europe/Moscow");
  });
});

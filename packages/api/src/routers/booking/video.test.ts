import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import {
  notifyBookingConfirmed,
  notifyVideoLinkChanged,
  sendVideoReminders,
} from "@synoro/jobs/booking-video";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ROOM = "https://acme.ktalk.ru/anna";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;
let client: Session;
let memberId: string;

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  const notices = () =>
    sent.map((m) => (m.props as unknown as { notice: string }).notice);
  return { sent, deliver, notices };
}

/** A confirmed consultation starting `inMs` from now. */
async function insertBooking(inMs: number, meetingUrl?: string) {
  const startsAt = new Date(Date.now() + inMs);
  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
      memberId,
      meetingUrl,
    })
    .returning();
  if (!booking) throw new Error("no booking");
  return booking;
}

const clearBookings = () =>
  api.db.delete(Booking).where(eq(Booking.practiceId, practiceId));

const setRoom = (videoUrl: string) =>
  call(
    practiceRouter.setVideoUrl,
    { practiceId, videoUrl },
    { context: api.context(owner) },
  );

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-video", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  client = await createSession(api.db, {
    name: "Иван",
    email: "ivan@video.test",
  });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(client) },
  );
  memberId = member.id;
  await setRoom("acme.ktalk.ru/anna");
});
afterAll(async () => {
  if (api) await api.close();
});

describe("practice.setVideoUrl", () => {
  it("saved a clean https link and shows it to the owner", async () => {
    const practice = await call(
      practiceRouter.get,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(practice.videoUrl).toBe(ROOM);
  });

  it("keeps the room from clients and from the public page", async () => {
    const asClient = await call(
      practiceRouter.get,
      { practiceId },
      { context: api.context(client) },
    );
    expect(asClient.videoUrl).toBeNull();

    const publicPage = await call(
      practiceRouter.bySlug,
      { slug: "anna-video" },
      { context: api.context(client) },
    );
    expect(JSON.stringify(publicPage)).not.toContain("ktalk");
  });

  it("refuses a link that is not https", async () => {
    const error = await setRoom("http://acme.ktalk.ru/anna").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    const practice = await call(
      practiceRouter.get,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(practice.videoUrl).toBe(ROOM);
  });

  it("is for the owner only", async () => {
    const error = await call(
      practiceRouter.setVideoUrl,
      { practiceId, videoUrl: "https://evil.example.com/x" },
      { context: api.context(client) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("clears the link with an empty string", async () => {
    expect((await setRoom("")).videoUrl).toBeNull();
    await setRoom(ROOM);
  });
});

describe("booking.setMeetingUrl", () => {
  it("overrides the practice room for one booking in the calendar", async () => {
    const booking = await insertBooking(30 * DAY);
    const shown = () =>
      call(
        bookingRouter.calendar,
        {
          practiceId,
          from: booking.startsAt.toISOString().slice(0, 10),
          days: 2,
        },
        { context: api.context(owner) },
      ).then((rows) => rows.find((r) => r.id === booking.id));

    expect((await shown())?.videoUrl).toBe(ROOM);

    await call(
      bookingRouter.setMeetingUrl,
      { bookingId: booking.id, meetingUrl: "https://meet.google.com/abc-defg" },
      { context: api.context(owner) },
    );
    const own = await shown();
    expect(own?.meetingUrl).toBe("https://meet.google.com/abc-defg");
    expect(own?.videoUrl).toBe("https://meet.google.com/abc-defg");

    await call(
      bookingRouter.setMeetingUrl,
      { bookingId: booking.id, meetingUrl: "" },
      { context: api.context(owner) },
    );
    expect((await shown())?.videoUrl).toBe(ROOM);
  });

  it("is not available to a client", async () => {
    const booking = await insertBooking(31 * DAY);
    const error = await call(
      bookingRouter.setMeetingUrl,
      { bookingId: booking.id, meetingUrl: "https://evil.example.com/x" },
      { context: api.context(client) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("what the client sees", () => {
  it("gets the link of a confirmed booking in the cabinet", async () => {
    const booking = await insertBooking(40 * DAY);
    const rows = await call(bookingRouter.mine, undefined, {
      context: api.context(client),
    });
    expect(rows.find((r) => r.id === booking.id)?.videoUrl).toBe(ROOM);
  });

  it("does not get a link while the booking awaits payment", async () => {
    const booking = await insertBooking(41 * DAY);
    await api.db
      .update(Booking)
      .set({ holdUntil: new Date(Date.now() + HOUR) })
      .where(eq(Booking.id, booking.id));
    const rows = await call(bookingRouter.mine, undefined, {
      context: api.context(client),
    });
    expect(rows.find((r) => r.id === booking.id)?.videoUrl).toBeNull();
  });
});

describe("mails", () => {
  it("confirms a booking with the link", async () => {
    const booking = await insertBooking(50 * DAY);
    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);

    expect(mail.notices()).toEqual(["confirmed"]);
    expect(mail.sent[0]?.to).toEqual(["ivan@video.test"]);
    expect(mail.sent[0]?.props).toMatchObject({ videoUrl: ROOM });
  });

  it("does not mail about an unpaid hold", async () => {
    const booking = await insertBooking(51 * DAY);
    await api.db
      .update(Booking)
      .set({ holdUntil: new Date(Date.now() + HOUR) })
      .where(eq(Booking.id, booking.id));
    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);
    expect(mail.sent).toEqual([]);
  });

  it("tells only clients who use the practice room about a change", async () => {
    await clearBookings();
    await insertBooking(60 * DAY);
    await insertBooking(61 * DAY, "https://zoom.us/j/1");
    await insertBooking(-5 * DAY);
    const mail = recorder();

    await notifyVideoLinkChanged(api.db, { practiceId }, mail.deliver);

    // One mail: not the booking with its own link, not the past one.
    expect(mail.notices()).toEqual(["link"]);
  });

  it("says nothing when the link was cleared", async () => {
    await clearBookings();
    await setRoom("");
    await insertBooking(60 * DAY);
    const mail = recorder();
    await notifyVideoLinkChanged(api.db, { practiceId }, mail.deliver);
    expect(mail.sent).toEqual([]);
    await setRoom(ROOM);
  });

  it("notifies every booking across batches even if one delivery fails", async () => {
    await clearBookings();
    const count = 401;
    const bookings = Array.from({ length: count }, (_, index) => {
      const startsAt = new Date(Date.now() + (60 + index) * DAY);
      return {
        id: `00000000-0000-4000-8000-${String(count - index).padStart(12, "0")}`,
        practiceId,
        kind: "consultation" as const,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
        memberId,
      };
    });
    await api.db.insert(Booking).values(bookings);
    const mail = recorder();
    let attempts = 0;

    await notifyVideoLinkChanged(api.db, { practiceId }, async (message) => {
      attempts++;
      if (attempts === 1) throw new Error("mail down");
      await mail.deliver(message);
    });

    expect(attempts).toBe(count);
    expect(mail.notices()).toEqual(Array(count - 1).fill("link"));
    expect(
      new Set(mail.sent.map((message) => JSON.stringify(message.props))).size,
    ).toBe(count - 1);
  });
});

describe("reminders", () => {
  it("sends the day reminder and the hour reminder once each", async () => {
    await clearBookings();
    await insertBooking(12 * HOUR);
    const imminent = await insertBooking(30 * MINUTE);

    const mail = recorder();
    await sendVideoReminders(api.db, mail.deliver);
    expect(mail.notices().sort()).toEqual(["reminder-day", "reminder-hour"]);

    await sendVideoReminders(api.db, mail.deliver);
    expect(mail.sent).toHaveLength(2);

    // Within the hour, the hour reminder also covers the day one.
    const row = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, imminent.id),
    });
    expect(row?.reminderHourSentAt).not.toBeNull();
    expect(row?.reminderDaySentAt).not.toBeNull();
  });

  it("skips bookings without any link and far-off ones", async () => {
    await clearBookings();
    await setRoom("");
    await insertBooking(5 * HOUR);
    const mail = recorder();
    await sendVideoReminders(api.db, mail.deliver);
    expect(mail.sent).toEqual([]);

    await setRoom(ROOM);
    await clearBookings();
    await insertBooking(3 * DAY);
    await sendVideoReminders(api.db, mail.deliver);
    expect(mail.sent).toEqual([]);
  });

  it("gives the claim back when sending fails", async () => {
    await clearBookings();
    const booking = await insertBooking(6 * HOUR);
    await sendVideoReminders(api.db, async () => {
      throw new Error("mail down");
    });
    const row = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, booking.id),
    });
    expect(row?.reminderDaySentAt).toBeNull();

    const mail = recorder();
    await sendVideoReminders(api.db, mail.deliver);
    expect(mail.notices()).toEqual(["reminder-day"]);
  });

  it("does not remind a cancelled booking", async () => {
    await clearBookings();
    const booking = await insertBooking(7 * HOUR);
    await api.db
      .update(Booking)
      .set({ status: "cancelled" })
      .where(eq(Booking.id, booking.id));
    const mail = recorder();
    await sendVideoReminders(api.db, mail.deliver);
    expect(mail.sent).toEqual([]);
  });
});

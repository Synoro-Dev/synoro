import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import {
  Booking,
  type BookingCancelReason,
  eq,
  PracticeMember,
} from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import {
  notifyBookingCancelled,
  notifyBookingConfirmed,
  notifySeriesBooked,
  notifySeriesCancelled,
} from "@synoro/jobs/booking-video";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from "../practice";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let admin: Session;
let client: Session;
let practiceId: string;
let memberId: string;

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  /** `template:notice → recipient` for each mail, in order. */
  const log = () =>
    sent.map((m) => {
      const { notice } = m.props as unknown as { notice: string };
      return `${m.template}:${notice} → ${m.to.join(",")}`;
    });
  return { sent, deliver, log };
}

/** A paid booking of the client, `inMs` from now, made by `createdBy`. */
async function paidBooking(inMs: number, createdBy: Session) {
  const startsAt = new Date(Date.now() + inMs);
  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      memberId,
      createdById: createdBy.user.id,
    })
    .returning();
  if (!booking) throw new Error("no booking");
  return booking;
}

async function cancel(
  bookingId: string,
  reason: BookingCancelReason,
  by: Session | null,
) {
  await api.db
    .update(Booking)
    .set({
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: new Date(),
      cancelledById: by?.user.id ?? null,
    })
    .where(eq(Booking.id, bookingId));
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, {
    name: "Анна",
    email: "anna@notices.test",
  });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-notices", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  admin = await createSession(api.db, {
    name: "Ольга",
    email: "olga@notices.test",
  });
  await api.db
    .insert(PracticeMember)
    .values({ practiceId, userId: admin.user.id, role: "admin" });
  client = await createSession(api.db, {
    name: "Иван",
    email: "ivan@notices.test",
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

describe("a booking is made", () => {
  it("tells the client and all staff when the client booked", async () => {
    const booking = await paidBooking(3 * DAY, client);
    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);
    expect(mail.log()).toEqual([
      "booking-notice:confirmed → ivan@notices.test",
      "staff-booking:booked → anna@notices.test",
      "staff-booking:booked → olga@notices.test",
    ]);
    expect(mail.sent[1]?.props).toMatchObject({
      clientName: "Иван",
      clientPhone: "+79001234567",
      free: false,
      calendarUrl: `http://localhost:3000/practices/${practiceId}/calendar`,
    });
  });

  it("does not tell the staff member who made it", async () => {
    const booking = await paidBooking(4 * DAY, owner);
    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);
    expect(mail.log()).toEqual([
      "booking-notice:confirmed → ivan@notices.test",
      "staff-booking:booked → olga@notices.test",
    ]);
  });

  it("tells the owner about a guest the administrator booked", async () => {
    const startsAt = new Date(Date.now() + 5 * DAY);
    const [booking] = await api.db
      .insert(Booking)
      .values({
        practiceId,
        kind: "free",
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR / 2),
        guestName: "Пётр",
        guestPhone: "+79007654321",
        createdById: admin.user.id,
      })
      .returning();
    if (!booking) throw new Error("no booking");
    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);
    expect(mail.log()).toEqual(["staff-booking:booked → anna@notices.test"]);
    expect(mail.sent[0]?.props).toMatchObject({
      clientName: "Пётр",
      clientPhone: "+79007654321",
      free: true,
    });
  });
});

describe("a booking is cancelled", () => {
  it("by the client: the client and all staff hear of it", async () => {
    const booking = await paidBooking(6 * DAY, client);
    await cancel(booking.id, "client", client);
    const mail = recorder();
    await notifyBookingCancelled(
      api.db,
      booking.id,
      { refunded: true },
      mail.deliver,
    );
    expect(mail.log()).toEqual([
      "booking-notice:cancelled → ivan@notices.test",
      "staff-booking:cancelled → anna@notices.test",
      "staff-booking:cancelled → olga@notices.test",
    ]);
    expect(mail.sent[0]?.props).toMatchObject({
      cancelledBy: "client",
      refunded: true,
      videoUrl: null,
    });
    expect(mail.sent[1]?.props).toMatchObject({
      cancelledBy: "client",
      refunded: true,
    });
  });

  it("by the owner: the client and the administrator hear of it", async () => {
    const booking = await paidBooking(7 * DAY, client);
    await cancel(booking.id, "staff", owner);
    const mail = recorder();
    await notifyBookingCancelled(
      api.db,
      booking.id,
      { refunded: false },
      mail.deliver,
    );
    expect(mail.log()).toEqual([
      "booking-notice:cancelled → ivan@notices.test",
      "staff-booking:cancelled → olga@notices.test",
    ]);
    expect(mail.sent[0]?.props).toMatchObject({
      cancelledBy: "specialist",
      refunded: false,
    });
  });

  it("is silent about a no-show and a lapsed hold", async () => {
    const noShow = await paidBooking(-HOUR, client);
    await cancel(noShow.id, "no_show", owner);
    const hold = await paidBooking(8 * DAY, client);
    await api.db
      .update(Booking)
      .set({ holdUntil: new Date(Date.now() - HOUR) })
      .where(eq(Booking.id, hold.id));
    await cancel(hold.id, "hold_expired", null);

    const mail = recorder();
    for (const id of [noShow.id, hold.id]) {
      await notifyBookingCancelled(
        api.db,
        id,
        { refunded: false },
        mail.deliver,
      );
    }
    expect(mail.sent).toEqual([]);
  });
});

describe("a series", () => {
  it("is one mail to the client and one to each staff member", async () => {
    const first = await paidBooking(9 * DAY, client);
    const second = await paidBooking(16 * DAY, client);
    const ids = [second.id, first.id];

    const booked = recorder();
    await notifySeriesBooked(api.db, ids, booked.deliver);
    expect(booked.log()).toEqual([
      "booking-notice:confirmed → ivan@notices.test",
      "staff-booking:booked → anna@notices.test",
      "staff-booking:booked → olga@notices.test",
    ]);
    const props = booked.sent[0]?.props as { when: string; dates: string[] };
    expect(props.dates).toHaveLength(2);
    expect(props.when).toStartWith("2 встречи, первая — ");
    expect(props.when).toContain(props.dates[0] ?? "-");

    for (const b of [first, second]) await cancel(b.id, "client", client);
    const cancelled = recorder();
    await notifySeriesCancelled(
      api.db,
      ids,
      { by: "client", refunded: true },
      cancelled.deliver,
    );
    expect(cancelled.log()).toEqual([
      "booking-notice:cancelled → ivan@notices.test",
      "staff-booking:cancelled → anna@notices.test",
      "staff-booking:cancelled → olga@notices.test",
    ]);
    expect(cancelled.sent[1]?.props).toMatchObject({
      refunded: true,
      dates: props.dates,
    });
  });
});

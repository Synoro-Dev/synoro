import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq, PracticeMember } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import {
  notifyBookingConfirmed,
  sendBookingReminders,
} from "@synoro/jobs/booking-video";
import { sendStaffAgendas } from "@synoro/jobs/staff-agenda";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from ".";

const HOUR = 60 * 60 * 1000;

let api: Awaited<ReturnType<typeof setupTestApi>>;

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  return { sent, deliver };
}

/** A practice (Moscow time) with an owner, an administrator and a client. */
async function newPractice(slug: string) {
  const owner = await createSession(api.db, {
    name: "Анна",
    email: `owner@${slug}.test`,
  });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "psychologist" },
    { context: api.context(owner) },
  );
  const admin = await createSession(api.db, {
    name: "Ольга",
    email: `admin@${slug}.test`,
  });
  await api.db
    .insert(PracticeMember)
    .values({ practiceId: practice.id, userId: admin.user.id, role: "admin" });
  const client = await createSession(api.db, {
    name: "Иван",
    email: `client@${slug}.test`,
    phone: "+79001112233",
  });
  const member = await call(
    practiceRouter.join,
    { practiceId: practice.id },
    { context: api.context(client) },
  );
  return { owner, admin, client, practiceId: practice.id, memberId: member.id };
}

async function book(
  practiceId: string,
  startsAt: string,
  values: Partial<typeof Booking.$inferInsert> = {},
) {
  const start = new Date(startsAt);
  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      startsAt: start,
      endsAt: new Date(start.getTime() + HOUR),
      ...values,
    })
    .returning();
  if (!booking) throw new Error("no booking");
  return booking;
}

const setNotifications = (
  session: Session,
  input: Parameters<typeof practiceRouter.setNotifications.callable>[0],
) =>
  call(practiceRouter.setNotifications, input, {
    context: api.context(session),
  });

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(async () => {
  if (api) await api.close();
});

/** Sunday 6 Jan 2030, 20:00 in Moscow. */
const EVENING = new Date("2030-01-06T17:00:00Z");

describe("tomorrow's agenda", () => {
  it("sends the next day's bookings to the owner and admins, once", async () => {
    const { practiceId, memberId } = await newPractice("agenda");
    await book(practiceId, "2030-01-07T07:00:00Z", { memberId });
    await book(practiceId, "2030-01-07T09:00:00Z", {
      kind: "free",
      endsAt: new Date("2030-01-07T09:30:00Z"),
      guestName: "Мария",
      guestPhone: "+79005556677",
    });
    // Not tomorrow, cancelled, an unpaid hold, a blocked hour: left out.
    await book(practiceId, "2030-01-08T07:00:00Z", { memberId });
    await book(practiceId, "2030-01-07T11:00:00Z", {
      memberId,
      status: "cancelled",
      cancelReason: "client",
      cancelledAt: new Date("2030-01-06T10:00:00Z"),
    });
    await book(practiceId, "2030-01-07T12:00:00Z", {
      memberId,
      holdUntil: new Date("2030-01-06T17:10:00Z"),
    });
    await book(practiceId, "2030-01-07T13:00:00Z", { kind: "blocked" });

    const mail = recorder();
    // 17:00 in Moscow: too early.
    await sendStaffAgendas(
      api.db,
      mail.deliver,
      new Date(EVENING.getTime() - 3 * HOUR),
    );
    expect(mail.sent).toHaveLength(0);

    await sendStaffAgendas(api.db, mail.deliver, EVENING);
    const ours = mail.sent.filter((m) =>
      m.to.some((to) => to.endsWith("@agenda.test")),
    );
    expect(ours.map((m) => m.to[0]).sort()).toEqual([
      "admin@agenda.test",
      "owner@agenda.test",
    ]);
    expect(ours[0]).toMatchObject({
      template: "staff-agenda",
      subject: "Расписание на завтра, понедельник, 7 января: Анна Иванова",
      props: {
        practiceName: "Анна Иванова",
        date: "понедельник, 7 января",
        meetings: [
          {
            time: "10:00–11:00",
            clientName: "Иван",
            clientPhone: "+79001112233",
            free: false,
          },
          {
            time: "12:00–12:30",
            clientName: "Мария",
            clientPhone: "+79005556677",
            free: true,
          },
        ],
      },
    });

    // The next run the same evening sends nothing again.
    const again = recorder();
    await sendStaffAgendas(
      api.db,
      again.deliver,
      new Date(EVENING.getTime() + HOUR),
    );
    expect(
      again.sent.filter((m) => m.to.some((to) => to.endsWith("@agenda.test"))),
    ).toHaveLength(0);
  });

  it("sends nothing for an empty day or when turned off", async () => {
    const empty = await newPractice("agenda-empty");
    await book(empty.practiceId, "2030-01-08T07:00:00Z", {
      memberId: empty.memberId,
    });
    const off = await newPractice("agenda-off");
    await book(off.practiceId, "2030-01-07T07:00:00Z", {
      memberId: off.memberId,
    });
    await setNotifications(off.owner, {
      practiceId: off.practiceId,
      dailyAgenda: false,
    });

    const mail = recorder();
    await sendStaffAgendas(api.db, mail.deliver, EVENING);
    expect(
      mail.sent.filter((m) =>
        m.to.some((to) => /@agenda-(empty|off)\.test$/.test(to)),
      ),
    ).toHaveLength(0);
  });
});

describe("notification switches", () => {
  it("are the owner's to change", async () => {
    const { owner, admin, practiceId } = await newPractice("switches");
    expect(
      await setNotifications(owner, { practiceId, notifyStaff: false }),
    ).toEqual({ remindClients: true, notifyStaff: false, dailyAgenda: true });

    const error = await setNotifications(admin, {
      practiceId,
      remindClients: false,
    }).catch((e) => e);
    expect(isDefinedError(error) && error.code).toBe("FORBIDDEN");
  });

  it("stop staff notices but keep the client's confirmation", async () => {
    const { owner, practiceId, memberId } = await newPractice("no-staff");
    await setNotifications(owner, { practiceId, notifyStaff: false });
    const booking = await book(practiceId, "2030-02-04T07:00:00Z", {
      memberId,
    });

    const mail = recorder();
    await notifyBookingConfirmed(api.db, booking.id, mail.deliver);
    expect(mail.sent.map((m) => `${m.template} → ${m.to[0]}`)).toEqual([
      "booking-notice → client@no-staff.test",
    ]);
  });

  it("stop reminders to clients", async () => {
    const { owner, practiceId, memberId } = await newPractice("no-remind");
    const at = new Date("2030-03-04T06:30:00Z");
    const booking = await book(practiceId, "2030-03-04T07:00:00Z", {
      memberId,
    });

    await setNotifications(owner, { practiceId, remindClients: false });
    const off = recorder();
    await sendBookingReminders(api.db, off.deliver, at);
    expect(off.sent.filter((m) => m.to[0] === "client@no-remind.test")).toEqual(
      [],
    );

    await setNotifications(owner, { practiceId, remindClients: true });
    const on = recorder();
    await sendBookingReminders(api.db, on.deliver, at);
    expect(
      on.sent
        .filter((m) => m.to[0] === "client@no-remind.test")
        .map((m) => m.subject),
    ).toEqual(["Напоминание: встреча через час — Анна Иванова"]);
    expect(
      (
        await api.db.query.Booking.findFirst({
          where: eq(Booking.id, booking.id),
        })
      )?.reminderHourSentAt,
    ).not.toBeNull();
  });
});

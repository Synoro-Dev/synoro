import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, SentNotice, Subscription } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import {
  dueProNotice,
  type ProPlan,
  sendProNotices,
} from "@synoro/jobs/pro-notices";

import { createSession, setupTestApi } from "../../../test/helpers";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The early users' trial end (migration `0006_billing`). */
const NEW_YEAR = new Date("2027-01-01T00:00:00+03:00");
/** 16 December, 9:00 Moscow time: the first daytime run 16 days ahead. */
const DEC_16 = new Date("2026-12-16T09:00:00+03:00");

let api: Awaited<ReturnType<typeof setupTestApi>>;

/** Records mails instead of sending them. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const deliver = async (message: TemplateEmail) => {
    sent.push(message);
  };
  const to = (email: string) => sent.filter((m) => m.to.includes(email));
  const notices = (email: string) =>
    to(email).map((m) => (m.props as unknown as { notice: string }).notice);
  return { sent, deliver, to, notices };
}

/** A specialist with a subscription row as given. */
async function specialist(
  email: string,
  plan: { trialEndsAt: Date; createdAt: Date; paidUntil?: Date },
) {
  const session = await createSession(api.db, { email, name: "Анна" });
  await api.db.insert(Subscription).values({
    userId: session.user.id,
    trialEndsAt: plan.trialEndsAt,
    paidUntil: plan.paidUntil,
    createdAt: plan.createdAt,
  });
  return session;
}

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(async () => {
  await api.close();
});

describe("dueProNotice", () => {
  const trial = (createdAt: Date): ProPlan => ({
    createdAt,
    trialEndsAt: new Date(createdAt.getTime() + 14 * DAY),
    paidUntil: null,
    lastPeriod: null,
  });
  const at = (plan: ProPlan, offset: number) =>
    dueProNotice(plan, new Date(plan.trialEndsAt.getTime() + offset))?.notice;

  it("gives a 14-day trial the 3-day and the ended notice only", () => {
    const plan = trial(new Date("2026-11-01T12:00:00Z"));
    expect(at(plan, -14 * DAY)).toBeUndefined();
    expect(at(plan, -10 * DAY)).toBeUndefined();
    expect(at(plan, -3 * DAY + HOUR)).toBe("ending");
    expect(at(plan, HOUR)).toBe("ended");
    expect(at(plan, 3 * DAY)).toBeUndefined();
  });

  it("warns 16 days ahead about long periods", () => {
    const early: ProPlan = {
      createdAt: new Date("2026-10-01T12:00:00Z"),
      trialEndsAt: NEW_YEAR,
      paidUntil: null,
      lastPeriod: null,
    };
    expect(dueProNotice(early, DEC_16)?.notice).toBe("ending-soon");
    expect(
      dueProNotice(early, new Date(NEW_YEAR.getTime() - 17 * DAY)),
    ).toBeUndefined();

    const paidUntil = new Date(NEW_YEAR.getTime() + 30 * DAY);
    const tenDaysBefore = new Date(paidUntil.getTime() - 10 * DAY);
    const month = { ...early, paidUntil, lastPeriod: "month" as const };
    expect(dueProNotice(month, tenDaysBefore)).toBeUndefined();
    const year = { ...early, paidUntil, lastPeriod: "year" as const };
    expect(dueProNotice(year, tenDaysBefore)).toMatchObject({
      notice: "ending-soon",
      endsAt: paidUntil,
      paid: true,
    });
  });
});

describe("sendProNotices", () => {
  it("writes to the early users by 16 December, once", async () => {
    const email = "early@notices.test";
    await specialist(email, {
      trialEndsAt: NEW_YEAR,
      createdAt: new Date("2026-10-01T12:00:00Z"),
    });

    const mail = recorder();
    await sendProNotices(api.db, mail.deliver, DEC_16);
    expect(mail.notices(email)).toEqual(["ending-soon"]);
    const [message] = mail.to(email);
    expect(message?.subject).toBe(
      "Бесплатный период «Про» заканчивается 1 января 2027",
    );
    expect(message?.props).toMatchObject({
      endsOn: "1 января 2027",
      left: "через 15 дней",
      billingUrl: "http://localhost:3000/settings/billing",
    });

    await sendProNotices(
      api.db,
      mail.deliver,
      new Date(DEC_16.getTime() + HOUR),
    );
    expect(mail.to(email)).toHaveLength(1);

    const dec29 = new Date("2026-12-29T10:00:00+03:00");
    await sendProNotices(api.db, mail.deliver, dec29);
    const jan1 = new Date("2027-01-01T09:30:00+03:00");
    await sendProNotices(api.db, mail.deliver, jan1);
    expect(mail.notices(email)).toEqual(["ending-soon", "ending", "ended"]);
  });

  it("sends nothing at night", async () => {
    const email = "night@notices.test";
    await specialist(email, {
      trialEndsAt: NEW_YEAR,
      createdAt: new Date("2026-10-01T12:00:00Z"),
    });
    const mail = recorder();
    await sendProNotices(
      api.db,
      mail.deliver,
      new Date("2026-12-16T03:00:00+03:00"),
    );
    expect(mail.to(email)).toEqual([]);
  });

  it("gives the claim back when sending fails", async () => {
    const email = "flaky@notices.test";
    const now = new Date("2026-11-20T12:00:00+03:00");
    const session = await specialist(email, {
      createdAt: new Date(now.getTime() - 12 * DAY),
      trialEndsAt: new Date(now.getTime() + 2 * DAY),
    });

    await sendProNotices(
      api.db,
      async () => {
        throw new Error("mail down");
      },
      now,
    );
    const claims = await api.db
      .select()
      .from(SentNotice)
      .where(eq(SentNotice.userId, session.user.id));
    expect(claims).toEqual([]);

    const mail = recorder();
    await sendProNotices(api.db, mail.deliver, now);
    expect(mail.notices(email)).toEqual(["ending"]);
  });

  it("starts over when the specialist pays", async () => {
    const email = "payer@notices.test";
    const now = new Date("2026-11-20T12:00:00+03:00");
    const trialEndsAt = new Date(now.getTime() + 2 * DAY);
    const session = await specialist(email, {
      createdAt: new Date(now.getTime() - 12 * DAY),
      trialEndsAt,
    });
    const mail = recorder();
    await sendProNotices(api.db, mail.deliver, now);
    expect(mail.notices(email)).toEqual(["ending"]);

    const paidUntil = new Date(trialEndsAt.getTime() + 30 * DAY);
    await api.db
      .update(Subscription)
      .set({ paidUntil })
      .where(eq(Subscription.userId, session.user.id));
    await sendProNotices(api.db, mail.deliver, new Date(now.getTime() + HOUR));
    expect(mail.to(email)).toHaveLength(1);

    await sendProNotices(
      api.db,
      mail.deliver,
      new Date(paidUntil.getTime() - 2 * DAY),
    );
    expect(mail.notices(email)).toEqual(["ending", "ending"]);
    expect(mail.to(email)[1]?.props).toMatchObject({ paid: true });
  });

  it("does not announce «Про» that ended days ago", async () => {
    const email = "lapsed@notices.test";
    const now = new Date("2026-11-20T12:00:00+03:00");
    await specialist(email, {
      createdAt: new Date(now.getTime() - 20 * DAY),
      trialEndsAt: new Date(now.getTime() - 6 * DAY),
    });
    const mail = recorder();
    await sendProNotices(api.db, mail.deliver, now);
    expect(mail.to(email)).toEqual([]);
  });
});

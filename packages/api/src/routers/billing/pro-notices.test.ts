import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, SentNotice, Subscription, SubscriptionPayment } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import {
  dueProNotice,
  type ProPlan,
  sendProNotices,
} from "@synoro/jobs/pro-notices";

import { createSession, setupTestApi } from "../../../test/helpers";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** End of a paid year, midnight Moscow time. */
const YEAR_END = new Date("2027-11-20T00:00:00+03:00");

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

/** A specialist with a subscription row as given; `year` — paid for a year. */
async function specialist(
  email: string,
  plan: { trialEndsAt: Date; paidUntil?: Date; year?: boolean },
) {
  const session = await createSession(api.db, { email, name: "Анна" });
  await api.db.insert(Subscription).values({
    userId: session.user.id,
    trialEndsAt: plan.trialEndsAt,
    paidUntil: plan.paidUntil,
  });
  if (plan.year && plan.paidUntil) {
    await api.db.insert(SubscriptionPayment).values({
      userId: session.user.id,
      period: "year",
      amount: 1490_00,
      status: "succeeded",
      periodStart: new Date(plan.paidUntil.getTime() - 365 * DAY),
      periodEnd: plan.paidUntil,
      paidAt: new Date(plan.paidUntil.getTime() - 365 * DAY),
    });
  }
  return session;
}

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(async () => {
  await api.close();
});

describe("dueProNotice", () => {
  const trialEndsAt = new Date("2026-11-15T12:00:00Z");
  const trial: ProPlan = { trialEndsAt, paidUntil: null, lastPeriod: null };
  const at = (plan: ProPlan, endsAt: Date, offset: number) =>
    dueProNotice(plan, new Date(endsAt.getTime() + offset))?.notice;

  it("gives the 14-day trial the 3-day and the ended notice only", () => {
    expect(at(trial, trialEndsAt, -14 * DAY)).toBeUndefined();
    expect(at(trial, trialEndsAt, -10 * DAY)).toBeUndefined();
    expect(at(trial, trialEndsAt, -3 * DAY + HOUR)).toBe("ending");
    expect(at(trial, trialEndsAt, HOUR)).toBe("ended");
    expect(at(trial, trialEndsAt, 3 * DAY)).toBeUndefined();
  });

  it("warns two weeks ahead only when a paid year ends", () => {
    const paidUntil = new Date(trialEndsAt.getTime() + 365 * DAY);
    const year: ProPlan = { trialEndsAt, paidUntil, lastPeriod: "year" };
    expect(at(year, paidUntil, -15 * DAY)).toBeUndefined();
    expect(
      dueProNotice(year, new Date(paidUntil.getTime() - 10 * DAY)),
    ).toMatchObject({ notice: "ending-soon", endsAt: paidUntil, paid: true });
    expect(at(year, paidUntil, -2 * DAY)).toBe("ending");

    const month: ProPlan = { ...year, lastPeriod: "month" };
    expect(at(month, paidUntil, -10 * DAY)).toBeUndefined();
    expect(at(month, paidUntil, -2 * DAY)).toBe("ending");
  });
});

describe("sendProNotices", () => {
  it("walks a paid year to its end, one mail per notice", async () => {
    const email = "year@notices.test";
    await specialist(email, {
      trialEndsAt: new Date(YEAR_END.getTime() - 365 * DAY),
      paidUntil: YEAR_END,
      year: true,
    });

    const mail = recorder();
    const twoWeeks = new Date("2027-11-06T10:00:00+03:00");
    await sendProNotices(api.db, mail.deliver, twoWeeks);
    expect(mail.notices(email)).toEqual(["ending-soon"]);
    const [message] = mail.to(email);
    expect(message?.subject).toBe(
      "Оплаченный период «Про» заканчивается 20 ноября 2027",
    );
    expect(message?.props).toMatchObject({
      paid: true,
      endsOn: "20 ноября 2027",
      left: "через 13 дней",
      billingUrl: "http://localhost:3000/settings/billing",
    });

    await sendProNotices(
      api.db,
      mail.deliver,
      new Date(twoWeeks.getTime() + HOUR),
    );
    expect(mail.to(email)).toHaveLength(1);

    const nov17 = new Date("2027-11-17T10:00:00+03:00");
    await sendProNotices(api.db, mail.deliver, nov17);
    const nov20 = new Date("2027-11-20T09:30:00+03:00");
    await sendProNotices(api.db, mail.deliver, nov20);
    expect(mail.notices(email)).toEqual(["ending-soon", "ending", "ended"]);
  });

  it("sends nothing at night", async () => {
    const email = "night@notices.test";
    const night = new Date("2026-11-20T03:00:00+03:00");
    await specialist(email, {
      trialEndsAt: new Date(night.getTime() + 2 * DAY),
    });
    const mail = recorder();
    await sendProNotices(api.db, mail.deliver, night);
    expect(mail.to(email)).toEqual([]);
  });

  it("gives the claim back when sending fails", async () => {
    const email = "flaky@notices.test";
    const now = new Date("2026-11-20T12:00:00+03:00");
    const session = await specialist(email, {
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
      trialEndsAt: new Date(now.getTime() - 6 * DAY),
    });
    const mail = recorder();
    await sendProNotices(api.db, mail.deliver, now);
    expect(mail.to(email)).toEqual([]);
  });
});

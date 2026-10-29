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

  it("reclaims an expired pending notice and marks it sent only after delivery", async () => {
    const email = "crashed@notices.test";
    const now = new Date("2028-11-20T12:00:00+03:00");
    const trialEndsAt = new Date(now.getTime() + 2 * DAY);
    const session = await specialist(email, { trialEndsAt });
    const key = `pro:ending:${session.user.id}:${trialEndsAt.toISOString()}`;
    const oldToken = crypto.randomUUID();
    await api.db.insert(SentNotice).values({
      key,
      userId: session.user.id,
      claimToken: oldToken,
      claimExpiresAt: new Date(Date.now() - 1),
    });
    const mail = recorder();
    await sendProNotices(
      api.db,
      async (message) => {
        const [pending] = await api.db
          .select()
          .from(SentNotice)
          .where(eq(SentNotice.key, key));
        expect(pending?.sentAt).toBeNull();
        expect(pending?.claimToken).not.toBe(oldToken);
        expect(pending?.claimExpiresAt?.getTime()).toBeGreaterThan(Date.now());
        await mail.deliver(message);
      },
      now,
    );
    expect(mail.notices(email)).toEqual(["ending"]);
    const [sent] = await api.db
      .select()
      .from(SentNotice)
      .where(eq(SentNotice.key, key));
    expect(sent?.sentAt).toBeInstanceOf(Date);
    expect(sent?.claimToken).toBeNull();
    expect(sent?.claimExpiresAt).toBeNull();
    await sendProNotices(api.db, mail.deliver, now);
    expect(mail.to(email)).toHaveLength(1);
  });

  it("keeps a second worker from sending while delivery is pending", async () => {
    const email = "concurrent@notices.test";
    const now = new Date("2029-11-20T12:00:00+03:00");
    await specialist(email, { trialEndsAt: new Date(now.getTime() + 2 * DAY) });
    const first = recorder();
    const second = recorder();
    await sendProNotices(
      api.db,
      async (message) => {
        await sendProNotices(api.db, second.deliver, now);
        await first.deliver(message);
      },
      now,
    );
    expect(first.notices(email)).toEqual(["ending"]);
    expect(second.to(email)).toEqual([]);
  });

  for (const fails of [false, true]) {
    it(`does not ${fails ? "delete" : "finish"} a newer worker's claim`, async () => {
      const email = `stale-${fails}@notices.test`;
      const now = new Date("2030-11-20T12:00:00+03:00");
      const trialEndsAt = new Date(now.getTime() + 2 * DAY);
      const session = await specialist(email, { trialEndsAt });
      const key = `pro:ending:${session.user.id}:${trialEndsAt.toISOString()}`;
      const newToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + HOUR);
      await sendProNotices(
        api.db,
        async (message) => {
          if (!message.to.includes(email)) return;
          // Simulate expiry and another worker taking ownership during delivery.
          await api.db
            .update(SentNotice)
            .set({ claimToken: newToken, claimExpiresAt: expiresAt })
            .where(eq(SentNotice.key, key));
          if (fails) throw new Error("stale worker failed");
        },
        now,
      );
      const [pending] = await api.db
        .select()
        .from(SentNotice)
        .where(eq(SentNotice.key, key));
      expect(pending).toMatchObject({
        sentAt: null,
        claimToken: newToken,
        claimExpiresAt: expiresAt,
      });
    });
  }

  it("lazily loads the sender only for default delivery and awaits its confirmation", async () => {
    // A fresh process prevents the API's other email imports from hiding eager loads.
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      let loads = 0;
      mock.module("@synoro/emails", () => {
        loads++;
        return { sendTemplateEmail: (message, options) => globalThis.confirmDelivery(message, options) };
      });
      const { sendProNotices } = await import("@synoro/jobs/pro-notices");
      assert.equal(loads, 0);
      const { createTestDb } = await import("@synoro/db/testing");
      const { user, Subscription, SentNotice } = await import("@synoro/db");
      const { db, close } = await createTestDb();
      try {
        const now = new Date("2031-11-20T12:00:00+03:00");
        let calls = 0;
        const add = async (id) => {
          await db.insert(user).values({ id, email: id + "@notices.test", name: "Test" });
          await db.insert(Subscription).values({ userId: id, trialEndsAt: new Date(now.getTime() + 86400000) });
        };
        await add("injected");
        await sendProNotices(db, async () => { calls++; }, now);
        assert.equal(calls, 1);
        assert.equal(loads, 0);
        await add("default");
        globalThis.confirmDelivery = async (message, options) => {
          assert.equal(options.requireDelivery, true);
          assert.deepEqual(message.to, ["default@notices.test"]);
          const pending = (await db.select().from(SentNotice)).find(row => row.userId === "default");
          assert.equal(pending.sentAt, null);
          throw new Error("provider rejected delivery");
        };
        await sendProNotices(db, undefined, now);
        assert.equal(loads, 1);
        assert.equal((await db.select().from(SentNotice)).length, 1);
        globalThis.confirmDelivery = async () => { calls++; };
        await sendProNotices(db, undefined, now);
        assert.equal(calls, 2);
        assert.ok((await db.select().from(SentNotice)).every(row => row.sentAt instanceof Date));
      } finally { await close(); }
    `,
      ],
      {
        cwd: new URL("../../../../jobs/", import.meta.url).pathname,
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ status, output: stdout + stderr }).toEqual({
      status: 0,
      output: "",
    });
  });

  for (const configured of [false, true]) {
    it(`rejects unconfirmed email delivery when ${configured ? "the provider returns an error" : "the provider is missing"}`, async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `
        import assert from "node:assert/strict";
        import { mock } from "bun:test";
        globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
        mock.module("resend", () => ({
          Resend: class { emails = { send: async () => ({ error: { message: "provider rejected delivery" } }) }; }
        }));
        const { sendTemplateEmail } = await import("@synoro/emails");
        const message = { template: "pro-notice", to: ["test@notices.test"], subject: "Test",
          props: { notice: "ended", name: "Test", paid: false, endsOn: "today", left: "", prices: "", billingUrl: "http://localhost:3000/settings/billing" }
        };
        await assert.rejects(sendTemplateEmail(message, { requireDelivery: true }),
          new RegExp(process.env.RESEND_API_KEY ? "provider rejected delivery" : "Email delivery is not configured"));
        // The option is opt-in: preserve the existing behavior of other callers.
        await sendTemplateEmail(message);
      `,
        ],
        {
          cwd: new URL("../../../../jobs/", import.meta.url).pathname,
          env: {
            ...process.env,
            RESEND_API_KEY: configured ? "re_local_test" : "",
            EMAIL_SANDBOX_ENABLED: "false",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ status, output: stdout + stderr }).toEqual({
        status: 0,
        output: "",
      });
    });
  }

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

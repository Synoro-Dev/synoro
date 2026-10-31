import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import {
  Booking,
  CreditEntry,
  eq,
  PracticeMember,
  SentNotice,
  Subscription,
  Workflow,
} from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import { sendWorkflowMessages } from "@synoro/jobs/workflow-messages";
import { MAX_WORKFLOWS, WORKFLOW_PRESETS } from "@synoro/validators";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from "../practice";
import { workflowRouter } from ".";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Tuesday noon, Moscow: inside the hours clients are mailed. */
const NOW = new Date("2026-11-03T12:00:00+03:00");
/** Rules in these tests were written well before `NOW`. */
const WRITTEN = new Date("2026-10-01T10:00:00+03:00");

let api: Awaited<ReturnType<typeof setupTestApi>>;

/** Records mails instead of sending them; `fail` makes the next ones throw. */
function recorder() {
  const sent: TemplateEmail[] = [];
  const state = { fail: false };
  const deliver = async (message: TemplateEmail) => {
    if (state.fail) throw new Error("smtp down");
    sent.push(message);
  };
  const to = (email: string) => sent.filter((m) => m.to.includes(email));
  return { sent, state, deliver, to };
}

async function newPractice(slug: string, pro = true) {
  const owner = await createSession(api.db, { name: "Анна Иванова" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "psychologist" },
    { context: api.context(owner) },
  );
  await api.db
    .update(Subscription)
    .set({
      // `hasPro` reads the real clock, the sender reads `NOW`: pro covers both.
      trialEndsAt: pro
        ? new Date(Math.max(Date.now(), NOW.getTime()) + 10 * DAY)
        : new Date("2020-01-01T00:00:00Z"),
      paidUntil: null,
    })
    .where(eq(Subscription.userId, owner.user.id));
  return { owner, practiceId: practice.id };
}

async function newClient(practiceId: string, email: string, credits = 0) {
  const session = await createSession(api.db, { name: "Иван Петров", email });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  await api.db
    .update(PracticeMember)
    .set({ credits })
    .where(eq(PracticeMember.id, member.id));
  return { session, memberId: member.id };
}

/** A meeting that ended `endedAgo` before `NOW` (one hour long). */
async function meeting(
  practiceId: string,
  memberId: string,
  endedAgo: number,
  status: "active" | "cancelled" = "active",
) {
  const endsAt = new Date(NOW.getTime() - endedAgo);
  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      memberId,
      startsAt: new Date(endsAt.getTime() - HOUR),
      endsAt,
      status,
      ...(status === "cancelled"
        ? { cancelReason: "client" as const, cancelledAt: endsAt }
        : {}),
    })
    .returning();
  if (!booking) throw new Error("no booking");
  return booking;
}

async function rule(
  practiceId: string,
  values: Partial<typeof Workflow.$inferInsert> &
    Pick<typeof Workflow.$inferInsert, "trigger" | "amount">,
) {
  const [row] = await api.db
    .insert(Workflow)
    .values({
      practiceId,
      subject: "Тема для {имя}",
      text: "Здравствуйте, {имя}! {дата} в {время}. Осталось: {баланс}. {ссылка}",
      createdAt: WRITTEN,
      ...values,
    })
    .returning();
  if (!row) throw new Error("no rule");
  return row;
}

const form = {
  trigger: "after_end" as const,
  amount: 2,
  subject: "Спасибо — {практика}",
  text: "Здравствуйте, {имя}!",
  active: true,
};

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(async () => {
  await api.close();
});

describe("workflow rules", () => {
  it("lets the owner create, list, change and delete rules", async () => {
    const { owner, practiceId } = await newPractice("wf-crud");
    const context = { context: api.context(owner) };

    const { id } = await call(
      workflowRouter.create,
      { ...form, practiceId },
      context,
    );
    const listed = await call(workflowRouter.list, { practiceId }, context);
    expect(listed.pro).toBe(true);
    expect(listed.workflows).toEqual([{ id, ...form }]);

    await call(
      workflowRouter.update,
      { ...form, id, amount: 5, active: false },
      context,
    );
    const changed = await call(workflowRouter.list, { practiceId }, context);
    expect(changed.workflows[0]).toMatchObject({ amount: 5, active: false });

    await api.db
      .insert(SentNotice)
      .values({ key: `wf:${id}:b:x`, userId: owner.user.id, sentAt: NOW });
    await call(workflowRouter.delete, { id }, context);
    expect(
      (await call(workflowRouter.list, { practiceId }, context)).workflows,
    ).toEqual([]);
    expect(
      await api.db.query.SentNotice.findFirst({
        where: eq(SentNotice.key, `wf:${id}:b:x`),
      }),
    ).toBeUndefined();
  });

  it("is for the owner only, and only of their own practice", async () => {
    const { owner, practiceId } = await newPractice("wf-access");
    const { id } = await call(
      workflowRouter.create,
      { ...form, practiceId },
      { context: api.context(owner) },
    );
    const admin = await createSession(api.db);
    await api.db
      .insert(PracticeMember)
      .values({ practiceId, userId: admin.user.id, role: "admin" });
    const { session: client } = await newClient(practiceId, "c@access.test");
    const stranger = await createSession(api.db);

    for (const session of [admin, client, stranger]) {
      const context = { context: api.context(session) };
      expect(
        await call(workflowRouter.list, { practiceId }, context).catch(
          (error) => isDefinedError(error) && error.code,
        ),
      ).toBe("FORBIDDEN");
      expect(
        await call(
          workflowRouter.create,
          { ...form, practiceId },
          context,
        ).catch((error) => isDefinedError(error) && error.code),
      ).toBe("FORBIDDEN");
      expect(
        await call(workflowRouter.update, { ...form, id }, context).catch(
          (error) => isDefinedError(error) && error.code,
        ),
      ).toBe("NOT_FOUND");
      expect(
        await call(workflowRouter.delete, { id }, context).catch(
          (error) => isDefinedError(error) && error.code,
        ),
      ).toBe("NOT_FOUND");
    }
  });

  it("needs «Про» to add or switch on a rule, not to switch it off", async () => {
    const { owner, practiceId } = await newPractice("wf-free", false);
    const context = { context: api.context(owner) };
    const created = await call(
      workflowRouter.create,
      { ...form, practiceId },
      context,
    ).catch((error) => isDefinedError(error) && error.code);
    expect(created).toBe("PLAN_REQUIRED");

    const { id } = await rule(practiceId, { trigger: "after_end", amount: 2 });
    const on = await call(
      workflowRouter.update,
      { ...form, id },
      context,
    ).catch((error) => isDefinedError(error) && error.code);
    expect(on).toBe("PLAN_REQUIRED");

    await call(workflowRouter.update, { ...form, id, active: false }, context);
    const listed = await call(workflowRouter.list, { practiceId }, context);
    expect(listed).toMatchObject({
      pro: false,
      workflows: [{ id, active: false }],
    });
  });

  it("only switches a rule off without «Про», leaving its text alone", async () => {
    const { owner, practiceId } = await newPractice("wf-free-edit", false);
    const { id } = await rule(practiceId, { trigger: "after_end", amount: 2 });
    const context = { context: api.context(owner) };

    await call(
      workflowRouter.update,
      {
        ...form,
        id,
        trigger: "inactive",
        amount: 30,
        text: "Другой текст",
        active: false,
      },
      context,
    );
    const [row] = await api.db
      .select()
      .from(Workflow)
      .where(eq(Workflow.id, id));
    expect(row).toMatchObject({
      active: false,
      trigger: "after_end",
      amount: 2,
      text: expect.stringContaining("{имя}"),
    });
  });

  it("does not let two requests take the last place", async () => {
    const { owner, practiceId } = await newPractice("wf-race");
    for (let i = 0; i < MAX_WORKFLOWS - 1; i++) {
      await rule(practiceId, { trigger: "after_end", amount: 2 });
    }
    const context = { context: api.context(owner) };
    const results = await Promise.allSettled([
      call(workflowRouter.create, { ...form, practiceId }, context),
      call(workflowRouter.create, { ...form, practiceId }, context),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await api.db
      .select()
      .from(Workflow)
      .where(eq(Workflow.practiceId, practiceId));
    expect(rows).toHaveLength(MAX_WORKFLOWS);
  });

  it("refuses an amount outside the trigger's range and too many rules", async () => {
    const { owner, practiceId } = await newPractice("wf-limits");
    const context = { context: api.context(owner) };
    const bad = await call(
      workflowRouter.create,
      { ...form, practiceId, trigger: "inactive", amount: 3 },
      context,
    ).catch((error) => error.code);
    expect(bad).toBe("BAD_REQUEST");

    for (let i = 0; i < MAX_WORKFLOWS; i++) {
      await rule(practiceId, { trigger: "after_end", amount: 2 });
    }
    const over = await call(
      workflowRouter.create,
      { ...form, practiceId },
      context,
    ).catch((error) => isDefinedError(error) && error.code);
    expect(over).toBe("LIMIT_REACHED");
  });
});

describe("after_end messages", () => {
  it("mails the client once, `amount` hours after the meeting", async () => {
    const { practiceId } = await newPractice("wf-end");
    const client = await newClient(practiceId, "ivan@end.test", 3);
    await meeting(practiceId, client.memberId, 3 * HOUR);
    await rule(practiceId, { trigger: "after_end", amount: 2 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.to("ivan@end.test")).toHaveLength(1);

    const [message] = mail.to("ivan@end.test");
    expect(message).toMatchObject({
      template: "workflow-message",
      subject: "Тема для Иван",
      props: {
        practiceName: "Анна Иванова",
        title: "Тема для Иван",
        text: "Здравствуйте, Иван! 3 ноября в 08:00. Осталось: 3. http://localhost:3000/p/wf-end",
      },
    });
  });

  it("waits for the offset and skips cancelled meetings and old ones", async () => {
    const { practiceId } = await newPractice("wf-end-skip");
    const early = await newClient(practiceId, "early@end.test");
    await meeting(practiceId, early.memberId, 1 * HOUR);
    const cancelled = await newClient(practiceId, "cancelled@end.test");
    await meeting(practiceId, cancelled.memberId, 3 * HOUR, "cancelled");
    const old = await newClient(practiceId, "old@end.test");
    await meeting(practiceId, old.memberId, 3 * DAY);
    await rule(practiceId, { trigger: "after_end", amount: 2 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);

    // An hour later the first client's two hours are up.
    await sendWorkflowMessages(
      api.db,
      mail.deliver,
      new Date(NOW.getTime() + HOUR),
    );
    expect(mail.sent.map((m) => m.to[0])).toEqual(["early@end.test"]);
  });

  it("does not mail meetings that ended before the rule existed", async () => {
    const { practiceId } = await newPractice("wf-end-new");
    const client = await newClient(practiceId, "ivan@new.test");
    await meeting(practiceId, client.memberId, 3 * HOUR);
    await rule(practiceId, {
      trigger: "after_end",
      amount: 2,
      createdAt: new Date(NOW.getTime() - HOUR),
    });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);
  });

  it("skips a meeting that ended before the rule, though its mail would fall after", async () => {
    const { practiceId } = await newPractice("wf-end-before");
    const client = await newClient(practiceId, "ivan@before.test");
    // Ended 3 h ago, two hours' delay: due 1 h ago, after the rule (2.5 h ago).
    await meeting(practiceId, client.memberId, 3 * HOUR);
    await rule(practiceId, {
      trigger: "after_end",
      amount: 2,
      createdAt: new Date(NOW.getTime() - 2.5 * HOUR),
    });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);
  });

  it("sends nothing at night and catches up in the morning", async () => {
    const { practiceId } = await newPractice("wf-end-night");
    const client = await newClient(practiceId, "ivan@night.test");
    await meeting(practiceId, client.memberId, 3 * HOUR);
    await rule(practiceId, { trigger: "after_end", amount: 2 });

    const mail = recorder();
    // 03:30 Moscow: the meeting ended 3 h before NOW, which is noon.
    const night = new Date("2026-11-03T03:30:00+03:00");
    await meeting(practiceId, client.memberId, 12 * HOUR + 30 * 60 * 1000);
    await sendWorkflowMessages(api.db, mail.deliver, night);
    expect(mail.sent).toEqual([]);

    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.to("ivan@night.test")).toHaveLength(2);
  });

  it("stops when the owner's «Про» has run out, and resumes with it", async () => {
    const { owner, practiceId } = await newPractice("wf-end-lapsed", false);
    const client = await newClient(practiceId, "ivan@lapsed.test");
    await meeting(practiceId, client.memberId, 3 * HOUR);
    await rule(practiceId, { trigger: "after_end", amount: 2 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);

    await api.db
      .update(Subscription)
      .set({ paidUntil: new Date(NOW.getTime() + 30 * DAY) })
      .where(eq(Subscription.userId, owner.user.id));
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toHaveLength(1);
  });

  it("gives the claim back when sending fails", async () => {
    const { practiceId } = await newPractice("wf-end-fail");
    const client = await newClient(practiceId, "ivan@fail.test");
    await meeting(practiceId, client.memberId, 3 * HOUR);
    await rule(practiceId, { trigger: "after_end", amount: 2 });

    const mail = recorder();
    mail.state.fail = true;
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);

    mail.state.fail = false;
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toHaveLength(1);
  });

  it("ignores inactive rules and mails clients only, not staff", async () => {
    const { owner, practiceId } = await newPractice("wf-end-staff");
    const staff = await createSession(api.db, { email: "admin@staff.test" });
    const [adminMember] = await api.db
      .insert(PracticeMember)
      .values({ practiceId, userId: staff.user.id, role: "admin" })
      .returning();
    await meeting(practiceId, adminMember?.id ?? "", 3 * HOUR);
    const client = await newClient(practiceId, "ivan@off.test");
    await meeting(practiceId, client.memberId, 3 * HOUR);
    const off = await rule(practiceId, {
      trigger: "after_end",
      amount: 2,
      active: false,
    });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);

    await api.db
      .update(Workflow)
      .set({ active: true })
      .where(eq(Workflow.id, off.id));
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent.map((m) => m.to[0])).toEqual(["ivan@off.test"]);
    expect(mail.to(owner.user.email)).toEqual([]);
  });
});

describe("low_balance messages", () => {
  /** A booking that spent a credit `ago` before `NOW`. */
  async function spend(memberId: string, practiceId: string, ago: number) {
    const booking = await meeting(practiceId, memberId, -DAY);
    const [entry] = await api.db
      .insert(CreditEntry)
      .values({
        memberId,
        delta: -1,
        reason: "booking",
        bookingId: booking.id,
        createdAt: new Date(NOW.getTime() - ago),
      })
      .returning();
    return entry;
  }

  it("mails a client a booking left with few meetings, once", async () => {
    const { practiceId } = await newPractice("wf-low");
    const low = await newClient(practiceId, "low@low.test", 1);
    await spend(low.memberId, practiceId, HOUR);
    const plenty = await newClient(practiceId, "plenty@low.test", 6);
    await spend(plenty.memberId, practiceId, HOUR);
    await rule(practiceId, { trigger: "low_balance", amount: 1 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent.map((m) => m.to[0])).toEqual(["low@low.test"]);
    expect(mail.sent[0]?.props).toMatchObject({
      text: expect.stringContaining("Осталось: 1."),
    });
  });

  it("leaves a client alone who topped up or got a refund since", async () => {
    const { practiceId } = await newPractice("wf-low-topped");
    const client = await newClient(practiceId, "paid@low.test", 1);
    await spend(client.memberId, practiceId, 2 * HOUR);
    await api.db.insert(CreditEntry).values({
      memberId: client.memberId,
      delta: 5,
      reason: "purchase",
      createdAt: new Date(NOW.getTime() - HOUR),
    });
    await rule(practiceId, { trigger: "low_balance", amount: 5 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);
  });

  it("counts a payment and the booking it paid for as one moment", async () => {
    const { practiceId } = await newPractice("wf-low-tie");
    const client = await newClient(practiceId, "tie@low.test", 0);
    const booking = await meeting(practiceId, client.memberId, -DAY);
    const at = new Date(NOW.getTime() - HOUR);
    // The purchase has the larger id: it must not hide the booking.
    await api.db.insert(CreditEntry).values([
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        memberId: client.memberId,
        delta: 1,
        reason: "purchase",
        createdAt: at,
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        memberId: client.memberId,
        delta: -1,
        reason: "booking",
        bookingId: booking.id,
        createdAt: at,
      },
    ]);
    await rule(practiceId, { trigger: "low_balance", amount: 0 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent.map((m) => m.to[0])).toEqual(["tie@low.test"]);
  });

  it("mails a series booked in one statement once", async () => {
    const { practiceId } = await newPractice("wf-low-series");
    const client = await newClient(practiceId, "series@low.test", 0);
    const at = new Date(NOW.getTime() - HOUR);
    for (let i = 1; i <= 3; i++) {
      const booking = await meeting(practiceId, client.memberId, -i * DAY);
      await api.db.insert(CreditEntry).values({
        memberId: client.memberId,
        delta: -1,
        reason: "booking",
        bookingId: booking.id,
        createdAt: at,
      });
    }
    await rule(practiceId, { trigger: "low_balance", amount: 0 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toHaveLength(1);
  });

  it("waits ten minutes so a client can top up first", async () => {
    const { practiceId } = await newPractice("wf-low-wait");
    const client = await newClient(practiceId, "wait@low.test", 0);
    await spend(client.memberId, practiceId, 3 * 60 * 1000);
    await rule(practiceId, { trigger: "low_balance", amount: 0 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);
    await sendWorkflowMessages(
      api.db,
      mail.deliver,
      new Date(NOW.getTime() + 10 * 60 * 1000),
    );
    expect(mail.sent).toHaveLength(1);
  });
});

describe("inactive messages", () => {
  it("mails a client whose last meeting ended N days ago, once", async () => {
    const { practiceId } = await newPractice("wf-idle");
    const gone = await newClient(practiceId, "gone@idle.test");
    await meeting(practiceId, gone.memberId, 31 * DAY);
    await meeting(practiceId, gone.memberId, 60 * DAY);
    const recent = await newClient(practiceId, "recent@idle.test");
    await meeting(practiceId, recent.memberId, 5 * DAY);
    const ancient = await newClient(practiceId, "ancient@idle.test");
    await meeting(practiceId, ancient.memberId, 90 * DAY);
    await rule(practiceId, { trigger: "inactive", amount: 30 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent.map((m) => m.to[0])).toEqual(["gone@idle.test"]);
  });

  it("skips a client who has a meeting booked ahead", async () => {
    const { practiceId } = await newPractice("wf-idle-ahead");
    const client = await newClient(practiceId, "ahead@idle.test");
    await meeting(practiceId, client.memberId, 31 * DAY);
    await meeting(practiceId, client.memberId, -3 * DAY);
    await rule(practiceId, { trigger: "inactive", amount: 30 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toEqual([]);
  });

  it("mails a returning client again after their next lapse", async () => {
    const { owner, practiceId } = await newPractice("wf-idle-again");
    const client = await newClient(practiceId, "again@idle.test");
    await meeting(practiceId, client.memberId, 31 * DAY);
    await rule(practiceId, { trigger: "inactive", amount: 30 });

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent).toHaveLength(1);

    // They came back for a meeting; a month on they went quiet again.
    await api.db
      .update(Subscription)
      .set({ paidUntil: new Date(NOW.getTime() + 60 * DAY) })
      .where(eq(Subscription.userId, owner.user.id));
    await meeting(practiceId, client.memberId, 0);
    await sendWorkflowMessages(
      api.db,
      mail.deliver,
      new Date(NOW.getTime() + 31 * DAY),
    );
    expect(mail.sent).toHaveLength(2);
  });
});

describe("presets", () => {
  it("renders every default text without leftover placeholders", async () => {
    const { practiceId } = await newPractice("wf-presets");
    const client = await newClient(practiceId, "ivan@presets.test", 1);
    await meeting(practiceId, client.memberId, 3 * HOUR);
    await meeting(practiceId, client.memberId, 31 * DAY);
    await api.db.insert(CreditEntry).values({
      memberId: client.memberId,
      delta: -1,
      reason: "booking",
      createdAt: new Date(NOW.getTime() - HOUR),
    });
    for (const trigger of ["after_end", "low_balance"] as const) {
      const preset = WORKFLOW_PRESETS[trigger];
      await rule(practiceId, {
        trigger,
        amount: preset.defaultAmount,
        subject: preset.subject,
        text: preset.text,
      });
    }

    const mail = recorder();
    await sendWorkflowMessages(api.db, mail.deliver, NOW);
    expect(mail.sent.length).toBeGreaterThanOrEqual(2);
    for (const message of mail.sent) {
      expect(message.subject).not.toMatch(/[{}]/);
      const props = message.props as { title: string; text: string };
      expect(props.title).not.toMatch(/[{}]/);
      expect(props.text).not.toMatch(/[{}]/);
    }
  });
});

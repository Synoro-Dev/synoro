import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import {
  AccountDeletion,
  account,
  Booking,
  BookingSeries,
  CalendarFeed,
  CreditEntry,
  DataAuditEntry,
  DataExport,
  DeletionRecord,
  eq,
  Practice,
  PracticeClient,
  PracticeMember,
  ReservedSlug,
  SlugOrder,
  Subscription,
  SubscriptionAutorenewal,
  SubscriptionPayment,
  user,
} from "@synoro/db";
import {
  type PurgeDeps,
  purgeAccount,
  purgeDueAccounts,
} from "@synoro/jobs/account-deletion";
import { sendBookingReminders } from "@synoro/jobs/booking-video";
import { collectAccount } from "@synoro/jobs/data-export";

import { createSession, setupTestApi } from "../../../test/helpers";
import { grantAccess } from "../../lib/data-access";
import { calendarFeedBody, hashFeedToken } from "../../lib/data-files";
import { bookingRouter } from "../booking";
import { practiceRouter } from "../practice";
import { accountRouter } from "./index";

let api: Awaited<ReturnType<typeof setupTestApi>>;

beforeAll(async () => {
  api = await setupTestApi();
});

afterAll(async () => {
  await api.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeOwner() {
  const session = await createSession(api.db, { name: "Анна Иванова" });
  const slug = `anna-${crypto.randomUUID().slice(0, 8)}`;
  const [practice] = await api.db
    .insert(Practice)
    .values({ name: "Практика Анны", slug, ownerId: session.user.id })
    .returning();
  if (!practice) throw new Error("no practice");
  await api.db.insert(PracticeMember).values({
    practiceId: practice.id,
    userId: session.user.id,
    role: "owner",
  });
  await grantAccess(api.db, session.session.id);
  return { session, practice };
}

async function addClient(
  practiceId: string,
  overrides: { credits?: number; emailVerified?: boolean } = {},
) {
  const client = await createSession(api.db, {
    name: "Ольга Петрова",
    emailVerified: overrides.emailVerified ?? false,
  });
  const [member] = await api.db
    .insert(PracticeMember)
    .values({
      practiceId,
      userId: client.user.id,
      role: "client",
      credits: overrides.credits ?? 0,
    })
    .returning();
  if (!member) throw new Error("no member");
  return { client, member };
}

function request(session: Awaited<ReturnType<typeof createSession>>) {
  return call(
    accountRouter.requestDeletion,
    { confirm: session.user.email, cancelBookings: false },
    { context: api.context(session) },
  );
}

/** Delete an account whose 30 days are over, as the cron would. */
async function purgeNow(userId: string, deps = fakeDeps().deps) {
  const past = new Date(Date.now() - 1000);
  await api.db
    .insert(AccountDeletion)
    .values({ userId, requestedAt: past, purgeAt: past })
    .onConflictDoUpdate({
      target: AccountDeletion.userId,
      set: { purgeAt: past },
    });
  return purgeAccount(api.db, userId, deps);
}

function fakeDeps() {
  const removed: string[] = [];
  const revoked: string[] = [];
  const deps: PurgeDeps = {
    removeFile: async (key) => void removed.push(key),
    revokeGoogle: async (token) => void revoked.push(token),
  };
  return { deps, removed, revoked };
}

describe("asking to delete", () => {
  it("needs a confirmed session and the account's own email", async () => {
    const { session } = await makeOwner();
    const other = { ...session, session: { ...session.session, id: "other" } };
    await expect(request(other)).rejects.toMatchObject({
      code: "ACCESS_REQUIRED",
    });
    await expect(
      call(
        accountRouter.requestDeletion,
        { confirm: "someone@else.test", cancelBookings: false },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
  });

  it("gives 30 days, stops auto-renewal and shows up in the journal", async () => {
    const { session } = await makeOwner();
    await api.db.insert(SubscriptionAutorenewal).values({
      userId: session.user.id,
      externalId: `op-${crypto.randomUUID()}`,
      period: "month",
      consentAt: new Date(),
    });
    const { purgeAt } = await request(session);
    const days = (purgeAt.getTime() - Date.now()) / DAY_MS;
    expect(Math.round(days)).toBe(30);

    const renewal = await api.db.query.SubscriptionAutorenewal.findFirst({
      where: eq(SubscriptionAutorenewal.userId, session.user.id),
    });
    expect(renewal?.status).toBe("canceled");

    const journal = await api.db
      .select({ action: DataAuditEntry.action })
      .from(DataAuditEntry)
      .where(eq(DataAuditEntry.userId, session.user.id));
    expect(journal.map((row) => row.action)).toContain("deletion_requested");
  });

  it("keeps the first date when asked twice", async () => {
    const { session } = await makeOwner();
    const first = await request(session);
    const second = await request(session);
    expect(second.purgeAt).toEqual(first.purgeAt);
  });

  it("waits while a payment may still be settled", async () => {
    const { session } = await makeOwner();
    await api.db.insert(SubscriptionPayment).values({
      userId: session.user.id,
      period: "month",
      amount: 14900,
    });
    await expect(request(session)).rejects.toMatchObject({
      code: "PAYMENT_IN_PROGRESS",
    });
  });

  it("is for owners of a practice", async () => {
    const lone = await createSession(api.db);
    await grantAccess(api.db, lone.session.id);
    await expect(request(lone)).rejects.toMatchObject({ code: "NO_PRACTICE" });
  });

  it("refuses an admin signed in as the owner", async () => {
    const { session } = await makeOwner();
    const impersonated = {
      ...session,
      session: { ...session.session, impersonatedBy: "admin-id" },
    } as typeof session;
    await expect(request(impersonated)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("counts what would go, and cancels upcoming bookings when asked", async () => {
    const { session, practice } = await makeOwner();
    const { member } = await addClient(practice.id, { credits: 2 });
    const at = (days: number) => new Date(Date.now() + days * DAY_MS);
    await api.db.insert(Booking).values([
      {
        practiceId: practice.id,
        kind: "consultation",
        // Refunded what it was charged.
        credits: 1,
        memberId: member.id,
        startsAt: at(3),
        endsAt: new Date(at(3).getTime() + 3_600_000),
      },
      {
        practiceId: practice.id,
        kind: "free",
        guestName: "Гость",
        startsAt: at(4),
        endsAt: new Date(at(4).getTime() + 1_800_000),
      },
      {
        practiceId: practice.id,
        kind: "blocked",
        startsAt: at(5),
        endsAt: new Date(at(5).getTime() + 3_600_000),
      },
    ]);

    const status = await call(accountRouter.deletionStatus, undefined, {
      context: api.context(session),
    });
    expect(status.practices).toEqual([
      {
        id: practice.id,
        name: practice.name,
        clients: 1,
        paidCredits: 2,
        upcoming: 2,
        upcomingGuests: 1,
      },
    ]);

    const { cancelled } = await call(
      accountRouter.requestDeletion,
      { confirm: session.user.email, cancelBookings: true },
      { context: api.context(session) },
    );
    expect(cancelled).toBe(2);

    const after = await api.db.query.PracticeMember.findFirst({
      where: eq(PracticeMember.id, member.id),
    });
    expect(after?.credits).toBe(3);
  });
});

describe("a request cut off halfway", () => {
  it("is finished by asking again, with the first choice and date", async () => {
    const { session, practice } = await makeOwner();
    const { member } = await addClient(practice.id, { credits: 1 });
    const at = new Date(Date.now() + 3 * DAY_MS);
    const [booking] = await api.db
      .insert(Booking)
      .values({
        practiceId: practice.id,
        kind: "consultation",
        memberId: member.id,
        startsAt: at,
        endsAt: new Date(at.getTime() + 3_600_000),
      })
      .returning();
    // As a failure leaves it: asked, chose to cancel, the rest didn't happen.
    const purgeAt = new Date(Date.now() + 20 * DAY_MS);
    await api.db.insert(AccountDeletion).values({
      userId: session.user.id,
      purgeAt,
      cancelBookings: true,
    });

    const result = await request(session); // asks with cancelBookings: false
    expect(result.purgeAt).toEqual(purgeAt);
    expect(result.cancelled).toBe(1);
    const after = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, booking?.id ?? ""),
    });
    expect(after?.status).toBe("cancelled");

    const again = await request(session);
    expect(again.cancelled).toBe(0);
    const journal = await api.db
      .select()
      .from(DataAuditEntry)
      .where(eq(DataAuditEntry.userId, session.user.id));
    expect(
      journal.filter((row) => row.action === "deletion_requested"),
    ).toHaveLength(1);
  });
});

describe("while it's on its way out", () => {
  it("closes the booking page and new bookings, and opens them on restore", async () => {
    const { session, practice } = await makeOwner();
    const visitor = await createSession(api.db);
    await request(session);

    const context = { context: api.context(null) };
    await expect(
      call(practiceRouter.bySlug, { slug: practice.slug }, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        bookingRouter.slots,
        { practiceId: practice.id, from: "2026-12-01", days: 1 },
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        practiceRouter.join,
        { practiceId: practice.id },
        { context: api.context(visitor) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call(accountRouter.cancelDeletion, undefined, {
      context: api.context(session),
    });
    const page = await call(
      practiceRouter.bySlug,
      { slug: practice.slug },
      context,
    );
    expect(page.id).toBe(practice.id);
  });

  it("sends no reminders, and sends them again after a restore", async () => {
    const { session, practice } = await makeOwner();
    const { member } = await addClient(practice.id);
    const startsAt = new Date(Date.now() + 30 * 60 * 1000);
    await api.db.insert(Booking).values({
      practiceId: practice.id,
      kind: "consultation",
      memberId: member.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
    });
    await request(session);

    const sent: unknown[] = [];
    const deliver = async (message: unknown) => void sent.push(message);
    await sendBookingReminders(api.db, deliver);
    expect(sent).toHaveLength(0);

    await call(accountRouter.cancelDeletion, undefined, {
      context: api.context(session),
    });
    await sendBookingReminders(api.db, deliver);
    expect(sent).toHaveLength(1);
  });

  it("turns the calendar feed off", async () => {
    const { session, practice } = await makeOwner();
    const token = "feed-token-of-a-leaving-owner";
    await api.db.insert(CalendarFeed).values({
      practiceId: practice.id,
      tokenHash: hashFeedToken(token),
    });
    expect(await calendarFeedBody(api.db, token)).toContain("VCALENDAR");
    await request(session);
    expect(await calendarFeedBody(api.db, token)).toBeNull();
  });
});

describe("the purge", () => {
  it("doesn't touch an account brought back after the cron picked it", async () => {
    const { session } = await makeOwner();
    await request(session);
    // The owner restores between the cron's selection and the delete: all the
    // purge finds, in its own transaction, is no request.
    await call(accountRouter.cancelDeletion, undefined, {
      context: api.context(session),
    });
    const { deps, removed } = fakeDeps();
    expect(await purgeAccount(api.db, session.user.id, deps)).toBe(false);
    expect(removed).toEqual([]);
    expect(
      await api.db.query.user.findFirst({
        where: eq(user.id, session.user.id),
      }),
    ).toBeDefined();
  });

  it("leaves other practices their client's card, balance and history", async () => {
    const { session } = await makeOwner();
    const other = await makeOwner();
    const [member] = await api.db
      .insert(PracticeMember)
      .values({
        practiceId: other.practice.id,
        userId: session.user.id,
        role: "client",
        credits: 4,
      })
      .returning();
    if (!member) throw new Error("no member");
    const [series] = await api.db
      .insert(BookingSeries)
      .values({
        practiceId: other.practice.id,
        memberId: member.id,
        intervalWeeks: 1,
        count: 2,
      })
      .returning();
    const [booking] = await api.db
      .insert(Booking)
      .values({
        practiceId: other.practice.id,
        kind: "consultation",
        memberId: member.id,
        seriesId: series?.id,
        startsAt: new Date("2027-01-10T10:00:00Z"),
        endsAt: new Date("2027-01-10T11:00:00Z"),
      })
      .returning();
    await api.db.insert(CreditEntry).values({
      memberId: member.id,
      delta: 4,
      reason: "purchase",
      note: "Пакет",
    });

    const status = await call(accountRouter.deletionStatus, undefined, {
      context: api.context(session),
    });
    expect(status.clientElsewhere).toBe(1);

    await purgeNow(session.user.id);

    const [card] = await api.db
      .select()
      .from(PracticeClient)
      .where(eq(PracticeClient.practiceId, other.practice.id));
    expect(card?.name).toBe(session.user.name);
    expect(card?.credits).toBe(4);

    const kept = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, booking?.id ?? ""),
    });
    expect(kept?.clientId).toBe(card?.id ?? "");
    expect(kept?.guestName).toBe(session.user.name);
    expect(kept?.seriesId).toBe(series?.id ?? "");

    const dump = await collectAccount(api.db, other.session.user.id);
    expect(dump.practices[0]?.credit_entries[0]).toMatchObject({
      delta: 4,
      reason: "purchase",
      client_id: card?.id,
    });
    expect(dump.practices[0]?.bookings[0]?.client_id).toBe(card?.id ?? "");
  });

  it("waits for the term", async () => {
    const { session } = await makeOwner();
    await request(session);
    await purgeDueAccounts(api.db, fakeDeps().deps);
    expect(
      await api.db.query.user.findFirst({
        where: eq(user.id, session.user.id),
      }),
    ).toBeDefined();
  });

  it("deletes the account, its practices and files, and keeps only payments without a name", async () => {
    const { session, practice } = await makeOwner();
    await api.db
      .update(Practice)
      .set({ image: `practices/${practice.id}/avatar.jpg` })
      .where(eq(Practice.id, practice.id));
    const { member } = await addClient(practice.id);
    await api.db.insert(Booking).values({
      practiceId: practice.id,
      kind: "consultation",
      memberId: member.id,
      startsAt: new Date("2026-01-01T10:00:00Z"),
      endsAt: new Date("2026-01-01T11:00:00Z"),
    });
    await api.db.insert(Subscription).values({
      userId: session.user.id,
      trialEndsAt: new Date(),
    });
    const [paid] = await api.db
      .insert(SubscriptionPayment)
      .values({
        userId: session.user.id,
        period: "year",
        amount: 149000,
        status: "succeeded",
        paidAt: new Date(),
        yclid: "click-of-this-person",
      })
      .returning();
    const [order] = await api.db
      .insert(SlugOrder)
      .values({
        userId: session.user.id,
        practiceId: practice.id,
        slug: "max",
        amount: 99000,
        status: "succeeded",
        holdUntil: new Date(),
      })
      .returning();
    await api.db.insert(DataExport).values({
      userId: session.user.id,
      kind: "full",
      status: "ready",
      fileKey: `exports/${session.user.id}/a.zip`,
    });
    await request(session);
    await api.db
      .update(AccountDeletion)
      .set({ purgeAt: new Date(Date.now() - 1000) })
      .where(eq(AccountDeletion.userId, session.user.id));

    const { deps, removed } = fakeDeps();
    await purgeDueAccounts(api.db, deps);

    expect(
      await api.db.query.user.findFirst({
        where: eq(user.id, session.user.id),
      }),
    ).toBeUndefined();
    expect(
      await api.db.query.Practice.findFirst({
        where: eq(Practice.id, practice.id),
      }),
    ).toBeUndefined();
    expect(
      await api.db
        .select()
        .from(Booking)
        .where(eq(Booking.practiceId, practice.id)),
    ).toEqual([]);
    expect(removed.sort()).toEqual(
      [
        `exports/${session.user.id}/a.zip`,
        `practices/${practice.id}/avatar.jpg`,
      ].sort(),
    );

    const kept = await api.db.query.SubscriptionPayment.findFirst({
      where: eq(SubscriptionPayment.id, paid?.id ?? ""),
    });
    expect(kept?.amount).toBe(149000);
    expect(kept?.userId).toBeNull();
    expect(kept?.yclid).toBeNull();
    const keptOrder = await api.db.query.SlugOrder.findFirst({
      where: eq(SlugOrder.id, order?.id ?? ""),
    });
    expect(keptOrder?.userId).toBeNull();
    expect(keptOrder?.practiceId).toBeNull();

    const records = await api.db.select().from(DeletionRecord);
    expect(JSON.stringify(records)).not.toContain(session.user.id);
    expect(records.at(-1)?.clients).toBe(1);
  });

  it("deletes clients who exist only because of this practice, not the others", async () => {
    const { session, practice } = await makeOwner();
    const other = await makeOwner();
    const { client: passive } = await addClient(practice.id);
    const { client: signedUp } = await addClient(practice.id);
    await api.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: signedUp.user.id,
      providerId: "credential",
      userId: signedUp.user.id,
      updatedAt: new Date(),
    });
    const { client: verified } = await addClient(practice.id, {
      emailVerified: true,
    });
    const { client: shared } = await addClient(practice.id);
    await api.db.insert(PracticeMember).values({
      practiceId: other.practice.id,
      userId: shared.user.id,
      role: "client",
    });

    await purgeNow(session.user.id);

    const exists = async (id: string) =>
      (await api.db.query.user.findFirst({ where: eq(user.id, id) })) !==
      undefined;
    expect(await exists(passive.user.id)).toBe(false);
    expect(await exists(signedUp.user.id)).toBe(true);
    expect(await exists(verified.user.id)).toBe(true);
    expect(await exists(shared.user.id)).toBe(true);
  });

  it("closes the address to others for a year", async () => {
    const { session, practice } = await makeOwner();
    await purgeNow(session.user.id);

    const reserved = await api.db.query.ReservedSlug.findFirst({
      where: eq(ReservedSlug.slug, practice.slug),
    });
    expect(reserved?.until.getTime()).toBeGreaterThan(
      Date.now() + 360 * DAY_MS,
    );

    const next = await createSession(api.db);
    await expect(
      call(
        practiceRouter.create,
        { name: "Другая", slug: practice.slug, profession: "other" },
        { context: api.context(next) },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("leaves a stubborn file behind rather than the account", async () => {
    const { session, practice } = await makeOwner();
    await api.db
      .update(Practice)
      .set({ image: `practices/${practice.id}/avatar.jpg` })
      .where(eq(Practice.id, practice.id));
    const { deps } = fakeDeps();
    deps.removeFile = async () => {
      throw new Error("bucket down");
    };
    expect(await purgeNow(session.user.id, deps)).toBe(true);
    expect(
      await api.db.query.user.findFirst({
        where: eq(user.id, session.user.id),
      }),
    ).toBeUndefined();
  });

  it("frees an address once its year is over", async () => {
    await api.db.insert(ReservedSlug).values({
      slug: "long-gone",
      until: new Date(Date.now() - 1000),
    });
    await purgeDueAccounts(api.db, fakeDeps().deps);
    expect(
      await api.db.query.ReservedSlug.findFirst({
        where: eq(ReservedSlug.slug, "long-gone"),
      }),
    ).toBeUndefined();
  });
});

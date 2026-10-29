import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { eq, PracticeDomain, Subscription } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from ".";

const DAY_MS = 24 * 60 * 60 * 1000;

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;

function bySlug(slug: string) {
  return call(practiceRouter.bySlug, { slug }, { context: api.context() });
}

function byHost(host: string) {
  return call(practiceRouter.byHost, { host }, { context: api.context() });
}

async function setPlan(values: { trialEndsAt: Date; paidUntil: Date | null }) {
  await api.db
    .update(Subscription)
    .set(values)
    .where(eq(Subscription.userId, owner.user.id));
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db);
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna", profession: "tutor" },
    { context: api.context(owner) },
  );
  await api.db.insert(PracticeDomain).values({
    practiceId: practice.id,
    hostname: "anna-ivanova.ru",
    verificationToken: "test-token",
    status: "active",
    verifiedAt: new Date(),
  });
});
afterAll(async () => {
  await api.close();
});

describe("practice.bySlug / byHost showBadge", () => {
  it("hides the badge during the «Про» trial", async () => {
    expect((await bySlug("anna")).showBadge).toBe(false);
    expect((await byHost("anna.pages.test")).showBadge).toBe(false);
  });

  it("shows the badge once «Про» lapses to the free plan", async () => {
    await setPlan({
      trialEndsAt: new Date(Date.now() - DAY_MS),
      paidUntil: null,
    });
    expect((await bySlug("anna")).showBadge).toBe(true);
    expect((await byHost("anna-ivanova.ru")).showBadge).toBe(true);
  });

  it("hides the badge while «Про» is paid", async () => {
    await setPlan({
      trialEndsAt: new Date(Date.now() - 30 * DAY_MS),
      paidUntil: new Date(Date.now() + DAY_MS),
    });
    expect((await bySlug("anna")).showBadge).toBe(false);
    expect((await byHost("anna-ivanova.ru")).showBadge).toBe(false);
  });

  it("shows the badge for a practice whose owner never had «Про»", async () => {
    await api.db
      .delete(Subscription)
      .where(eq(Subscription.userId, owner.user.id));
    expect((await bySlug("anna")).showBadge).toBe(true);
  });

  it("never sends the owner id to the page", async () => {
    expect(await bySlug("anna")).not.toHaveProperty("ownerId");
  });
});

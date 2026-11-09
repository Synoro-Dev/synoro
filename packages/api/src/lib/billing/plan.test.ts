import { describe, expect, it } from "bun:test";
import type { Subscription } from "@synoro/db";

import { planOf } from ".";

const DAY_MS = 24 * 60 * 60 * 1000;

function row(createdAt: Date, trialDays: number) {
  return {
    userId: "user",
    trialEndsAt: new Date(createdAt.getTime() + trialDays * DAY_MS),
    paidUntil: null,
    createdAt,
  } as unknown as typeof Subscription.$inferSelect;
}

describe("planOf", () => {
  it("keeps the length a trial was started with", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const started = new Date(now.getTime() - DAY_MS);
    const plan = planOf(row(started, 15), now);
    expect(plan.status).toBe("trial");
    expect(plan.trialDays).toBe(15);
  });

  it("has no trial length without a subscription", () => {
    expect(planOf(undefined).trialDays).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { eq, Practice, PracticeMember, Subscription } from "@synoro/db";
import { type BookingTheme, DEFAULT_BOOKING_THEME } from "@synoro/validators";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;

const THEME: BookingTheme = {
  accent: "emerald",
  font: "playfair",
  radius: "round",
  backdrop: "tint",
  about: "Психолог, работаю с тревогой и выгоранием",
};

async function newPractice(slug: string) {
  const owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "psychologist" },
    { context: api.context(owner) },
  );
  return { owner, practiceId: practice.id };
}

async function newMember(practiceId: string, role: "admin" | "client") {
  const session = await createSession(api.db, { name: "Иван" });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  await api.db
    .update(PracticeMember)
    .set({ role })
    .where(eq(PracticeMember.id, member.id));
  return session;
}

async function endPro(owner: Session) {
  await api.db
    .update(Subscription)
    .set({ trialEndsAt: new Date("2020-01-01T00:00:00Z"), paidUntil: null })
    .where(eq(Subscription.userId, owner.user.id));
}

const setTheme = (session: Session, practiceId: string, theme: BookingTheme) =>
  call(
    practiceRouter.setTheme,
    { practiceId, theme },
    { context: api.context(session) },
  );

const page = (slug: string) =>
  call(practiceRouter.bySlug, { slug }, { context: api.context() });

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(async () => {
  if (api) await api.close();
});

describe("booking page theme", () => {
  it("starts with the default look", async () => {
    const { owner, practiceId } = await newPractice("t-default");

    expect((await page("t-default")).theme).toEqual(DEFAULT_BOOKING_THEME);
    expect(
      await call(
        practiceRouter.theme,
        { practiceId },
        { context: api.context(owner) },
      ),
    ).toEqual({ theme: DEFAULT_BOOKING_THEME, pro: true });
  });

  it("is saved by the owner and administrators and shown on the page", async () => {
    const { owner, practiceId } = await newPractice("t-save");
    await setTheme(owner, practiceId, THEME);
    expect((await page("t-save")).theme).toEqual(THEME);

    const admin = await newMember(practiceId, "admin");
    const next = { ...THEME, accent: "blue" as const, about: "" };
    await setTheme(admin, practiceId, next);
    expect((await page("t-save")).theme).toEqual(next);
  });

  it("is closed to clients, and practice.get doesn't carry it", async () => {
    const { owner, practiceId } = await newPractice("t-client");
    await setTheme(owner, practiceId, THEME);
    const client = await newMember(practiceId, "client");

    const error = await setTheme(client, practiceId, THEME).catch((e) => e);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    const read = await call(
      practiceRouter.theme,
      { practiceId },
      { context: api.context(client) },
    ).catch((e) => e);
    expect(read).toMatchObject({ code: "FORBIDDEN" });

    const practice = await call(
      practiceRouter.get,
      { practiceId },
      { context: api.context(client) },
    );
    expect(practice).not.toHaveProperty("bookingTheme");
  });

  it("trims the «about» line and refuses a long one", async () => {
    const { owner, practiceId } = await newPractice("t-about");
    const saved = await setTheme(owner, practiceId, {
      ...THEME,
      about: "  Коуч  ",
    });
    expect(saved.theme.about).toBe("Коуч");

    const error = await setTheme(owner, practiceId, {
      ...THEME,
      about: "а".repeat(301),
    }).catch((e) => e);
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is «Про» only, goes default without it and comes back after", async () => {
    const { owner, practiceId } = await newPractice("t-free");
    await setTheme(owner, practiceId, THEME);
    await endPro(owner);

    expect((await page("t-free")).theme).toEqual(DEFAULT_BOOKING_THEME);
    const error = await setTheme(owner, practiceId, THEME).catch((e) => e);
    expect(isDefinedError(error) && error.code).toBe("PLAN_REQUIRED");
    // An administrator's own plan doesn't matter: the owner's does.
    const admin = await newMember(practiceId, "admin");
    const byAdmin = await setTheme(admin, practiceId, THEME).catch((e) => e);
    expect(isDefinedError(byAdmin) && byAdmin.code).toBe("PLAN_REQUIRED");

    // Kept meanwhile, and shown again once «Про» is paid — no saving anew.
    expect(
      await call(
        practiceRouter.theme,
        { practiceId },
        { context: api.context(owner) },
      ),
    ).toEqual({ theme: THEME, pro: false });

    await api.db
      .update(Subscription)
      .set({ paidUntil: new Date(Date.now() + 86_400_000) })
      .where(eq(Subscription.userId, owner.user.id));
    expect((await page("t-free")).theme).toEqual(THEME);
  });

  it("saves the default look without «Про»", async () => {
    const { owner, practiceId } = await newPractice("t-reset");
    await setTheme(owner, practiceId, THEME);
    await endPro(owner);

    const reset = await setTheme(owner, practiceId, DEFAULT_BOOKING_THEME);
    expect(reset.theme).toEqual(DEFAULT_BOOKING_THEME);
    expect((await page("t-reset")).theme).toEqual(DEFAULT_BOOKING_THEME);
  });

  it("shows a preset dropped since saving as its default", async () => {
    const { practiceId } = await newPractice("t-stale");
    await api.db
      .update(Practice)
      .set({ bookingTheme: { accent: "neon", font: "manrope" } })
      .where(eq(Practice.id, practiceId));

    expect((await page("t-stale")).theme).toEqual({
      ...DEFAULT_BOOKING_THEME,
      font: "manrope",
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;

beforeAll(async () => {
  api = await setupTestApi();
});

afterAll(async () => {
  await api.close();
});

describe("practice.create", () => {
  it("tells the team about the new practice and its owner", async () => {
    const session = await createSession(api.db, {
      name: "Анна Иванова",
      email: "anna@test.local",
      phone: "+79001234567",
    });
    api.sent.length = 0;

    await call(
      practiceRouter.create,
      { name: "Практика Анны", slug: "anna-practice", profession: "tutor" },
      { context: api.context(session) },
    );

    expect(api.sent).toHaveLength(1);
    const [notice] = api.sent;
    expect(notice?.template).toBe("team-notice");
    expect(notice?.to).toEqual(["team@test.local"]);
    expect(notice?.subject).toBe("Новая практика: Практика Анны");
    expect(JSON.stringify(notice?.props)).toContain("anna@test.local");
    expect(JSON.stringify(notice?.props)).toContain("anna-practice");
  });

  it("still creates the practice when the notice cannot be sent", async () => {
    const session = await createSession(api.db);
    const failing = {
      ...api.context(session),
      sendEmail: () => Promise.reject(new Error("mail is down")),
    };

    const practice = await call(
      practiceRouter.create,
      { name: "Без письма", slug: "no-mail-practice", profession: "tutor" },
      { context: failing },
    );

    expect(practice.slug).toBe("no-mail-practice");
  });
});

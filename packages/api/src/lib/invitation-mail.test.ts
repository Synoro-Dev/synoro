import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SentNotice, sql } from "@synoro/db";

import { createSession, setupTestApi } from "../../test/helpers";
import { claimInviteMail, MAX_INVITE_MAILS_PER_DAY } from "./invitation-mail";

let api: Awaited<ReturnType<typeof setupTestApi>>;

beforeAll(async () => {
  api = await setupTestApi();
});

afterAll(async () => {
  await api.close();
});

describe("invitation mail limits", () => {
  it("lets one mail per address, practice and role through, even at once", async () => {
    const sender = await createSession(api.db);
    const input = {
      userId: sender.user.id,
      practiceId: crypto.randomUUID(),
      role: "client",
      email: "once@anna.test",
    };

    const attempts = await Promise.all([
      claimInviteMail(api.db, input),
      claimInviteMail(api.db, input),
      claimInviteMail(api.db, input),
    ]);
    expect(attempts.filter((a) => a.status === "claimed")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "recent")).toHaveLength(2);

    // Another role is another invitation.
    expect(
      (await claimInviteMail(api.db, { ...input, role: "admin" })).status,
    ).toBe("claimed");

    // A failed send gives the right back.
    await attempts.find((a) => a.status === "claimed")?.release();
    expect((await claimInviteMail(api.db, input)).status).toBe("claimed");
  });

  it("counts a repeat to the same address after the cooldown", async () => {
    const sender = await createSession(api.db);
    const input = {
      userId: sender.user.id,
      practiceId: crypto.randomUUID(),
      role: "client",
      email: "again@anna.test",
    };
    const count = async () =>
      (
        await api.db
          .select({ key: SentNotice.key })
          .from(SentNotice)
          .where(sql`${SentNotice.userId} = ${sender.user.id}`)
      ).filter((row) => row.key.startsWith("invite-send:")).length;

    await claimInviteMail(api.db, input);
    // The cooldown passes.
    await api.db
      .update(SentNotice)
      .set({ sentAt: sql`now() - interval '2 hours'` })
      .where(sql`${SentNotice.key} like 'invite:%'`);
    expect((await claimInviteMail(api.db, input)).status).toBe("claimed");

    expect(await count()).toBe(2);
  });

  it("stops an account at the daily maximum, parallel requests included", async () => {
    const sender = await createSession(api.db);
    const practiceId = crypto.randomUUID();
    const invite = (i: number) =>
      claimInviteMail(api.db, {
        userId: sender.user.id,
        practiceId,
        role: "client",
        email: `guest${i}@anna.test`,
      });

    for (let i = 0; i < MAX_INVITE_MAILS_PER_DAY - 2; i++) await invite(i);

    // Five at once with room for two.
    const burst = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => invite(MAX_INVITE_MAILS_PER_DAY + i)),
    );
    expect(burst.filter((a) => a.status === "claimed")).toHaveLength(2);
    expect(burst.filter((a) => a.status === "exhausted")).toHaveLength(3);

    const other = await createSession(api.db);
    expect(
      (
        await claimInviteMail(api.db, {
          userId: other.user.id,
          practiceId,
          role: "client",
          email: "other@anna.test",
        })
      ).status,
    ).toBe("claimed");
  });
});

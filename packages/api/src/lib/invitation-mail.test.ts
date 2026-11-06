import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSession, setupTestApi } from "../../test/helpers";
import {
  claimInviteMail,
  inviteMailsExhausted,
  MAX_INVITE_MAILS_PER_DAY,
} from "./invitation-mail";

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
    expect(attempts.filter((a) => a.claimed)).toHaveLength(1);

    // Another role is another invitation.
    expect(
      (await claimInviteMail(api.db, { ...input, role: "admin" })).claimed,
    ).toBe(true);

    // A failed send gives the right back.
    await attempts.find((a) => a.claimed)?.release();
    expect((await claimInviteMail(api.db, input)).claimed).toBe(true);
  });

  it("stops an account after the daily maximum of mails", async () => {
    const sender = await createSession(api.db);
    const practiceId = crypto.randomUUID();
    expect(await inviteMailsExhausted(api.db, sender.user.id)).toBe(false);

    for (let i = 0; i < MAX_INVITE_MAILS_PER_DAY; i++) {
      await claimInviteMail(api.db, {
        userId: sender.user.id,
        practiceId,
        role: "client",
        email: `guest${i}@anna.test`,
      });
    }

    expect(await inviteMailsExhausted(api.db, sender.user.id)).toBe(true);
    const other = await createSession(api.db);
    expect(await inviteMailsExhausted(api.db, other.user.id)).toBe(false);
  });
});

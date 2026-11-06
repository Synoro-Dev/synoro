import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import { hashPassword } from "@synoro/auth/password";
import {
  account,
  and,
  Booking,
  ClientBackup,
  DataAuditEntry,
  DataExport,
  eq,
  Payment,
  PaymentAccount,
  Practice,
  PracticeMember,
  user,
} from "@synoro/db";
import {
  cleanupDataExports,
  collectAccount,
  type ExportDeps,
  runClientBackups,
  runDataExport,
} from "@synoro/jobs/data-export";
import { strFromU8, unzipSync } from "fflate";

import { createSession, setupTestApi } from "../../../test/helpers";
import { calendarFeedBody, openExportDownload } from "../../lib/data-files";
import { dataRouter } from "./index";

let api: Awaited<ReturnType<typeof setupTestApi>>;

beforeAll(async () => {
  api = await setupTestApi();
});

afterAll(async () => {
  await api.close();
});

async function makeOwner() {
  const session = await createSession(api.db, { name: "Анна Иванова" });
  const [practice] = await api.db
    .insert(Practice)
    .values({
      name: "Практика Анны",
      slug: `anna-${crypto.randomUUID().slice(0, 8)}`,
      ownerId: session.user.id,
      profession: "psychologist",
    })
    .returning();
  if (!practice) throw new Error("no practice");
  await api.db.insert(PracticeMember).values({
    practiceId: practice.id,
    userId: session.user.id,
    role: "owner",
  });
  return { session, practice };
}

async function addClient(
  practiceId: string,
  name: string,
  phone: string | null,
) {
  const session = await createSession(api.db, { name, phone });
  const [member] = await api.db
    .insert(PracticeMember)
    .values({ practiceId, userId: session.user.id, role: "client", credits: 3 })
    .returning();
  if (!member) throw new Error("no member");
  return member;
}

async function confirm(session: Awaited<ReturnType<typeof createSession>>) {
  const { grantAccess } = await import("../../lib/data-access");
  await grantAccess(api.db, session.session.id);
}

function fakeDeps() {
  const stored = new Map<string, Uint8Array>();
  const sent: { to: string; kind: string; expiresOn: string }[] = [];
  const deps: ExportDeps = {
    store: async (key, body) => void stored.set(key, body),
    remove: async (key) => void stored.delete(key),
    sendReady: async (message) => void sent.push(message),
  };
  return { deps, stored, sent };
}

describe("the archive", () => {
  it("holds every promised file, the CSVs ready for the Russian Excel", async () => {
    const { session, practice } = await makeOwner();
    const client = await addClient(
      practice.id,
      "Ольга Петрова",
      "+79001112233",
    );
    await api.db.insert(Booking).values({
      practiceId: practice.id,
      kind: "consultation",
      memberId: client.id,
      startsAt: new Date("2026-11-05T12:00:00Z"),
      endsAt: new Date("2026-11-05T13:00:00Z"),
      note: "=HYPERLINK(1)",
    });
    const [row] = await api.db
      .insert(DataExport)
      .values({ userId: session.user.id, kind: "full" })
      .returning();
    if (!row) throw new Error("no export");

    const { deps, stored, sent } = fakeDeps();
    await runDataExport(api.db, row.id, deps);

    const after = await api.db.query.DataExport.findFirst({
      where: eq(DataExport.id, row.id),
    });
    expect(after?.status).toBe("ready");
    expect(after?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(sent.map((mail) => mail.to)).toEqual([session.user.email]);

    const zip = stored.get(after?.fileKey ?? "");
    if (!zip) throw new Error("no file");
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      "README.txt",
      "appointments.csv",
      "calendar.ics",
      "clients.csv",
      "data.json",
      "payments.csv",
      "services.csv",
    ]);

    const read = (name: string) => {
      const file = files[name];
      if (!file) throw new Error(`no ${name}`);
      return strFromU8(file);
    };
    // The BOM is what tells Excel it's UTF-8; decoding drops it, so bytes.
    expect([...(files["clients.csv"] ?? []).slice(0, 3)]).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
    const clients = read("clients.csv");
    expect(clients).toContain("Имя;Телефон;");
    // A phone stays readable text, not a number and not an escaped value.
    expect(clients).toContain(";+7 900 111-22-33;");
    expect(clients).not.toContain("'+7");

    const appointments = read("appointments.csv");
    // 12:00 UTC is 15:00 in the practice's zone, Moscow.
    expect(appointments).toContain("05.11.2026 15:00;05.11.2026 16:00");
    expect(appointments).toContain("'=HYPERLINK(1)");
    expect(appointments).toContain("Ольга Петрова");

    const dump = JSON.parse(read("data.json"));
    expect(dump.format_version).toBe(1);
    expect(dump.practices[0].clients[0].id).toBe(client.id);
    expect(dump.practices[0].bookings[0].client_id).toBe(client.id);

    const ics = read("calendar.ics");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART:20261105T120000Z");
    expect(ics.replace(/\r\n /g, "")).toContain("Ольга Петрова");
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("never carries merchant keys or link secrets", async () => {
    const { session, practice } = await makeOwner();
    const [merchant] = await api.db
      .insert(PaymentAccount)
      .values({
        practiceId: practice.id,
        provider: "yookassa",
        merchantId: "shop-1",
        secret: "encrypted-merchant-secret",
      })
      .returning();
    if (!merchant) throw new Error("no account");
    await api.db.insert(Payment).values({
      practiceId: practice.id,
      accountId: merchant.id,
      provider: "yookassa",
      credits: 1,
      amount: 300000,
    });
    await api.db.insert(Booking).values({
      practiceId: practice.id,
      kind: "free",
      guestName: "Гость",
      startsAt: new Date("2026-12-01T10:00:00Z"),
      endsAt: new Date("2026-12-01T10:30:00Z"),
      accessTokenHash: "a".repeat(64),
    });
    const dump = await collectAccount(api.db, session.user.id);
    const text = JSON.stringify(dump);
    expect(text).not.toContain("encrypted-merchant-secret");
    expect(text).not.toContain("a".repeat(64));
    expect(dump.practices[0]?.payments[0]?.amount_kopecks).toBe(300000);
  });

  it("marks the export failed when the file can't be stored", async () => {
    const { session } = await makeOwner();
    const [row] = await api.db
      .insert(DataExport)
      .values({ userId: session.user.id, kind: "full" })
      .returning();
    if (!row) throw new Error("no export");
    const { deps, sent } = fakeDeps();
    deps.store = async () => {
      throw new Error("bucket down");
    };
    await expect(runDataExport(api.db, row.id, deps)).rejects.toThrow();
    const after = await api.db.query.DataExport.findFirst({
      where: eq(DataExport.id, row.id),
    });
    expect(after?.status).toBe("failed");
    expect(sent).toEqual([]);
  });
});

describe("who may take it", () => {
  async function readyExport(userId: string) {
    const [row] = await api.db
      .insert(DataExport)
      .values({
        userId,
        kind: "full",
        status: "ready",
        fileKey: `exports/${userId}/x.zip`,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!row) throw new Error("no export");
    return row;
  }

  it("answers 403 for someone else's archive", async () => {
    const { session } = await makeOwner();
    const row = await readyExport(session.user.id);
    const stranger = await createSession(api.db);
    const result = await openExportDownload(api.db, stranger, row.id);
    expect(result.status).toBe(403);
  });

  it("answers 401 signed out, 200 to the owner, and notes the download", async () => {
    const { session } = await makeOwner();
    const row = await readyExport(session.user.id);
    expect((await openExportDownload(api.db, null, row.id)).status).toBe(401);
    const opened = await openExportDownload(api.db, session, row.id);
    expect(opened.status).toBe(200);
    const journal = await api.db
      .select()
      .from(DataAuditEntry)
      .where(
        and(
          eq(DataAuditEntry.userId, session.user.id),
          eq(DataAuditEntry.action, "export_downloaded"),
        ),
      );
    expect(journal).toHaveLength(1);
  });

  it("answers 403 to an admin signed in as the owner", async () => {
    const { session } = await makeOwner();
    const row = await readyExport(session.user.id);
    const result = await openExportDownload(
      api.db,
      {
        ...session,
        session: { ...session.session, impersonatedBy: "admin-id" },
      } as typeof session,
      row.id,
    );
    expect(result.status).toBe(403);
  });

  it("answers 410 once the link ran out", async () => {
    const { session } = await makeOwner();
    const row = await readyExport(session.user.id);
    const later = new Date(Date.now() + 120_000);
    const result = await openExportDownload(api.db, session, row.id, later);
    expect(result.status).toBe(410);
  });

  it("asks an unconfirmed session to confirm before an export", async () => {
    const { session } = await makeOwner();
    await expect(
      call(dataRouter.startExport, undefined, {
        context: api.context(session),
      }),
    ).rejects.toMatchObject({ code: "ACCESS_REQUIRED" });
  });

  it("refuses an administrator of the practice", async () => {
    const { practice } = await makeOwner();
    const helper = await createSession(api.db);
    await api.db.insert(PracticeMember).values({
      practiceId: practice.id,
      userId: helper.user.id,
      role: "admin",
    });
    await confirm(helper);
    await expect(
      call(
        dataRouter.exportPart,
        { what: "clients", practiceId: practice.id },
        { context: api.context(helper) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(dataRouter.startExport, undefined, {
        context: api.context(helper),
      }),
    ).rejects.toMatchObject({ code: "NO_PRACTICE" });
  });

  it("is closed to demo visitors", async () => {
    const demo = await createSession(api.db, {
      email: "visitor@example.com",
    });
    await expect(
      call(dataRouter.overview, undefined, { context: api.context(demo) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows five full exports a day, on any plan", async () => {
    const { session } = await makeOwner();
    await confirm(session);
    await api.db.insert(DataExport).values(
      Array.from({ length: 5 }, () => ({
        userId: session.user.id,
        kind: "full" as const,
        status: "ready" as const,
      })),
    );
    await expect(
      call(dataRouter.startExport, undefined, {
        context: api.context(session),
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_EXPORTS" });
  });
});

describe("confirming access", () => {
  it("takes the right password and refuses a wrong one", async () => {
    const { session } = await makeOwner();
    await api.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: session.user.id,
      providerId: "credential",
      userId: session.user.id,
      password: await hashPassword("correct horse battery"),
      updatedAt: new Date(),
    });
    await expect(
      call(
        dataRouter.confirmAccess,
        { password: "wrong one here" },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await call(
      dataRouter.confirmAccess,
      { password: "correct horse battery" },
      { context: api.context(session) },
    );
    const overview = await call(dataRouter.overview, undefined, {
      context: api.context(session),
    });
    expect(overview.access).toEqual({ fresh: true, hasPassword: true });
  });

  it("stops password guessing after five tries, in parallel too", async () => {
    const { session } = await makeOwner();
    await api.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: session.user.id,
      providerId: "credential",
      userId: session.user.id,
      password: await hashPassword("correct horse battery"),
      updatedAt: new Date(),
    });
    const attempt = (password: string) =>
      call(
        dataRouter.confirmAccess,
        { password },
        { context: api.context(session) },
      ).catch((error: { code: string }) => error.code);
    const codes = await Promise.all(
      Array.from({ length: 7 }, () => attempt("wrong one here")),
    );
    expect(codes.filter((code) => code === "WRONG_PASSWORD")).toHaveLength(5);
    expect(codes.filter((code) => code === "TOO_MANY_ATTEMPTS")).toHaveLength(
      2,
    );
    // Even the right one now, until the window passes: a code still works.
    expect(await attempt("correct horse battery")).toBe("TOO_MANY_ATTEMPTS");
  });

  it("counts wrong codes in parallel without losing any", async () => {
    const { session } = await makeOwner();
    const { issueAccessCode } = await import("../../lib/data-access");
    const code = await issueAccessCode(api.db, session.session.id);
    if (!code) throw new Error("no code");
    const wrong = code === "000000" ? "000001" : "000000";
    await Promise.all(
      Array.from({ length: 5 }, () =>
        call(
          dataRouter.confirmAccess,
          { code: wrong },
          { context: api.context(session) },
        ).catch(() => undefined),
      ),
    );
    await expect(
      call(
        dataRouter.confirmAccess,
        { code },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "WRONG_CODE" });
  });

  it("burns a code after five wrong tries", async () => {
    const { session } = await makeOwner();
    const { issueAccessCode } = await import("../../lib/data-access");
    const code = await issueAccessCode(api.db, session.session.id);
    if (!code) throw new Error("no code");
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) {
      await expect(
        call(
          dataRouter.confirmAccess,
          { code: wrong },
          { context: api.context(session) },
        ),
      ).rejects.toMatchObject({ code: "WRONG_CODE" });
    }
    await expect(
      call(
        dataRouter.confirmAccess,
        { code },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "WRONG_CODE" });
  });

  it("doesn't take a code issued to another session", async () => {
    const { session } = await makeOwner();
    const { issueAccessCode } = await import("../../lib/data-access");
    const code = await issueAccessCode(api.db, session.session.id);
    if (!code) throw new Error("no code");
    const other = {
      ...session,
      session: { ...session.session, id: crypto.randomUUID() },
    };
    await expect(
      call(dataRouter.confirmAccess, { code }, { context: api.context(other) }),
    ).rejects.toMatchObject({ code: "WRONG_CODE" });
  });
});

describe("a table from a list", () => {
  it("gives the clients of the owner's practice", async () => {
    const { session, practice } = await makeOwner();
    await addClient(practice.id, "=cmd", "+79004445566");
    await confirm(session);
    const { csv, filename } = await call(
      dataRouter.exportPart,
      { what: "clients", practiceId: practice.id },
      { context: api.context(session) },
    );
    expect(filename).toContain(practice.slug);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("+7 900 444-55-66");
  });

  it("keeps to the period for bookings", async () => {
    const { session, practice } = await makeOwner();
    await confirm(session);
    await api.db.insert(Booking).values(
      ["2026-03-10", "2026-05-10"].map((day) => ({
        practiceId: practice.id,
        kind: "blocked" as const,
        note: `note-${day}`,
        startsAt: new Date(`${day}T10:00:00Z`),
        endsAt: new Date(`${day}T11:00:00Z`),
      })),
    );
    const { csv } = await call(
      dataRouter.exportPart,
      {
        what: "appointments",
        practiceId: practice.id,
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-04-01T00:00:00Z"),
      },
      { context: api.context(session) },
    );
    expect(csv).toContain("note-2026-03-10");
    expect(csv).not.toContain("note-2026-05-10");
  });
});

describe("the calendar feed", () => {
  function tokenOf(url: string) {
    return url.split("/").at(-1) ?? "";
  }

  it("says only «Запись» until names are turned on", async () => {
    const { session, practice } = await makeOwner();
    const client = await addClient(
      practice.id,
      "Ольга Петрова",
      "+79001112233",
    );
    await api.db.insert(Booking).values({
      practiceId: practice.id,
      kind: "consultation",
      memberId: client.id,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
    });
    await confirm(session);
    const { url } = await call(
      dataRouter.issueFeed,
      { practiceId: practice.id },
      { context: api.context(session) },
    );
    const hidden = await calendarFeedBody(api.db, tokenOf(url));
    expect(hidden).toContain("SUMMARY:Запись");
    expect(hidden).not.toContain("Ольга");
    expect(hidden).not.toContain("7900");

    await call(
      dataRouter.setFeedNames,
      { practiceId: practice.id, showNames: true },
      { context: api.context(session) },
    );
    const named = await calendarFeedBody(api.db, tokenOf(url));
    expect(named?.replace(/\r\n /g, "")).toContain("Ольга Петрова");
  });

  it("stops working when reissued or turned off", async () => {
    const { session, practice } = await makeOwner();
    await confirm(session);
    const input = { practiceId: practice.id };
    const context = { context: api.context(session) };
    const first = await call(dataRouter.issueFeed, input, context);
    const second = await call(dataRouter.issueFeed, input, context);
    expect(await calendarFeedBody(api.db, tokenOf(first.url))).toBeNull();
    expect(await calendarFeedBody(api.db, tokenOf(second.url))).toContain(
      "BEGIN:VCALENDAR",
    );
    await call(dataRouter.disableFeed, input, context);
    expect(await calendarFeedBody(api.db, tokenOf(second.url))).toBeNull();
  });

  it("leaves out cancelled bookings and unpaid holds that ran out", async () => {
    const { session, practice } = await makeOwner();
    await confirm(session);
    const at = (hours: number) => new Date(Date.now() + hours * 3_600_000);
    await api.db.insert(Booking).values([
      {
        id: "11111111-1111-4111-8111-111111111111",
        practiceId: practice.id,
        kind: "blocked",
        status: "cancelled",
        cancelReason: "staff",
        startsAt: at(10),
        endsAt: at(11),
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        practiceId: practice.id,
        kind: "free",
        guestName: "Без оплаты",
        holdUntil: at(-1),
        startsAt: at(20),
        endsAt: at(21),
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        practiceId: practice.id,
        kind: "blocked",
        startsAt: at(30),
        endsAt: at(31),
      },
    ]);
    const { url } = await call(
      dataRouter.issueFeed,
      { practiceId: practice.id },
      { context: api.context(session) },
    );
    const body = await calendarFeedBody(api.db, tokenOf(url));
    expect(body).not.toContain("11111111-1111");
    expect(body).not.toContain("22222222-2222");
    expect(body).toContain("33333333-3333");
  });

  it("is refused for someone else's practice", async () => {
    const { practice } = await makeOwner();
    const stranger = await createSession(api.db);
    await confirm(stranger);
    await expect(
      call(
        dataRouter.issueFeed,
        { practiceId: practice.id },
        { context: api.context(stranger) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("what runs on its own", () => {
  it("deletes an archive when its link runs out", async () => {
    const { session } = await makeOwner();
    const [row] = await api.db
      .insert(DataExport)
      .values({
        userId: session.user.id,
        kind: "full",
        status: "ready",
        fileKey: "exports/gone.zip",
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    if (!row) throw new Error("no export");
    const { deps, stored } = fakeDeps();
    stored.set("exports/gone.zip", new Uint8Array([1]));

    await cleanupDataExports(api.db, deps);

    expect(stored.size).toBe(0);
    const after = await api.db.query.DataExport.findFirst({
      where: eq(DataExport.id, row.id),
    });
    expect(after?.status).toBe("expired");
    expect(after?.fileKey).toBeNull();
  });

  it("keeps the record for a retry when the file won't delete", async () => {
    const { session } = await makeOwner();
    const [row] = await api.db
      .insert(DataExport)
      .values({
        userId: session.user.id,
        kind: "full",
        status: "ready",
        fileKey: "exports/stuck.zip",
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    if (!row) throw new Error("no export");
    const { deps } = fakeDeps();
    deps.remove = async () => {
      throw new Error("bucket down");
    };
    await cleanupDataExports(api.db, deps);
    const after = await api.db.query.DataExport.findFirst({
      where: eq(DataExport.id, row.id),
    });
    expect(after?.status).toBe("ready");
  });

  it("forgets journal lines after 12 months", async () => {
    const { session } = await makeOwner();
    await api.db.insert(DataAuditEntry).values([
      {
        userId: session.user.id,
        action: "export_requested",
        createdAt: new Date(Date.now() - 400 * 86_400_000),
      },
      { userId: session.user.id, action: "export_downloaded" },
    ]);
    await cleanupDataExports(api.db, fakeDeps().deps);
    const left = await api.db
      .select({ action: DataAuditEntry.action })
      .from(DataAuditEntry)
      .where(eq(DataAuditEntry.userId, session.user.id));
    expect(left.map((row) => row.action)).toEqual(["export_downloaded"]);
  });

  it("makes the weekly copy once a week, clients only", async () => {
    const { session, practice } = await makeOwner();
    await addClient(practice.id, "Ольга Петрова", "+79001112233");
    await confirm(session);
    await call(
      dataRouter.setBackup,
      { enabled: true },
      { context: api.context(session) },
    );

    const { deps, stored, sent } = fakeDeps();
    const monday = new Date();
    await runClientBackups(api.db, deps, monday);
    await runClientBackups(api.db, deps, new Date(monday.getTime() + 60_000));

    const mine = sent.filter((mail) => mail.to === session.user.email);
    expect(mine.map((mail) => mail.kind)).toEqual(["weekly"]);
    const key = [...stored.keys()].find((k) => k.includes(session.user.id));
    const files = unzipSync(stored.get(key ?? "") as Uint8Array);
    expect(Object.keys(files).sort()).toEqual(["README.txt", "clients.csv"]);

    const inAWeek = new Date(monday.getTime() + 7 * 86_400_000);
    await runClientBackups(api.db, deps, inAWeek);
    expect(sent.filter((mail) => mail.to === session.user.email)).toHaveLength(
      2,
    );

    await call(
      dataRouter.setBackup,
      { enabled: false },
      { context: api.context(session) },
    );
    expect(
      await api.db.query.ClientBackup.findFirst({
        where: eq(ClientBackup.userId, session.user.id),
      }),
    ).toBeUndefined();
  });

  it("serves those who waited longest first, and everyone in one run", async () => {
    const owners = await Promise.all([makeOwner(), makeOwner()]);
    const [fresh, waiting] = owners;
    if (!fresh || !waiting) throw new Error("no owners");
    const longAgo = new Date(Date.now() - 30 * 86_400_000);
    await api.db.insert(ClientBackup).values([
      {
        userId: fresh.session.user.id,
        lastRunAt: new Date(Date.now() - 7 * 86_400_000),
      },
      { userId: waiting.session.user.id, lastRunAt: longAgo },
    ]);
    const { deps, sent } = fakeDeps();
    await runClientBackups(api.db, deps);
    const order = sent.map((mail) => mail.to);
    expect(order.indexOf(waiting.session.user.email)).toBeLessThan(
      order.indexOf(fresh.session.user.email),
    );
    expect(order).toContain(fresh.session.user.email);
  });

  it("keeps foreign phones as text in a table", async () => {
    const { session, practice } = await makeOwner();
    await addClient(practice.id, "Ганс", "+4915112345678");
    await confirm(session);
    const { csv } = await call(
      dataRouter.exportPart,
      { what: "clients", practiceId: practice.id },
      { context: api.context(session) },
    );
    expect(csv).toContain("+49 15112345678");
  });

  it("notes turning names on and off in the feed", async () => {
    const { session, practice } = await makeOwner();
    await confirm(session);
    const context = { context: api.context(session) };
    await call(dataRouter.issueFeed, { practiceId: practice.id }, context);
    await call(
      dataRouter.setFeedNames,
      { practiceId: practice.id, showNames: true },
      context,
    );
    await call(
      dataRouter.setFeedNames,
      { practiceId: practice.id, showNames: false },
      context,
    );
    const journal = await api.db
      .select({ action: DataAuditEntry.action })
      .from(DataAuditEntry)
      .where(eq(DataAuditEntry.userId, session.user.id));
    const actions = journal.map((row) => row.action);
    expect(actions).toContain("feed_names_enabled");
    expect(actions).toContain("feed_names_disabled");
  });

  it("goes away with the account", async () => {
    const { session } = await makeOwner();
    await api.db
      .insert(DataExport)
      .values({ userId: session.user.id, kind: "full" });
    await api.db.delete(user).where(eq(user.id, session.user.id));
    const left = await api.db
      .select()
      .from(DataExport)
      .where(eq(DataExport.userId, session.user.id));
    expect(left).toEqual([]);
  });
});

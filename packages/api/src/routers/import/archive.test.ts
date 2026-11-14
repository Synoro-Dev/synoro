import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import {
  AvailabilityRule,
  Booking,
  BookingSeries,
  Consent,
  CreditEntry,
  eq,
  ImportBatch,
  ImportFile,
  OfflinePayment,
  Payment,
  PaymentAccount,
  PaymentPackage,
  Practice,
  PracticeClient,
  PracticeDocument,
  PracticeDocumentVersion,
  PracticeMember,
  user,
  Workflow,
} from "@synoro/db";
import { type AccountDump, collectAccount } from "@synoro/jobs/data-export";
import { cleanupImports, runImport } from "@synoro/jobs/data-import";
import { readBookingTheme } from "@synoro/validators";
import { strToU8, zipSync } from "fflate";

import { createSession, setupTestApi } from "../../../test/helpers";
import { importRouter } from "./index";

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
      name: "Новая практика",
      slug: `p-${crypto.randomUUID().slice(0, 8)}`,
      ownerId: session.user.id,
    })
    .returning();
  if (!practice) throw new Error("no practice");
  const [owner] = await api.db
    .insert(PracticeMember)
    .values({
      practiceId: practice.id,
      userId: session.user.id,
      role: "owner",
    })
    .returning();
  if (!owner) throw new Error("no owner");
  return {
    session,
    practice,
    owner,
    context: { context: api.context(session) },
  };
}

const DAY = 86_400_000;

/** A practice with one of everything that goes into an archive. */
async function richPractice() {
  const source = await makeOwner();
  const practiceId = source.practice.id;
  await api.db
    .update(Practice)
    .set({
      name: "Практика Анны",
      timezone: "Asia/Novosibirsk",
      profession: "psychologist",
      videoUrl: "https://company.ktalk.ru/anna",
      clientContact: "Телеграм @anna",
      bookingQuestions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          label: "Что привело?",
          kind: "text",
          options: [],
          required: true,
        },
      ],
      bookingTheme: { accent: "emerald", about: "Работаю с тревогой" },
      freeBookingEnabled: true,
      introMinutes: 45,
      remindClients: false,
      notifyStaff: false,
      dailyAgenda: false,
    })
    .where(eq(Practice.id, practiceId));
  await api.db.insert(AvailabilityRule).values([
    { practiceId, weekday: 1, startMinute: 600, endMinute: 780 },
    { practiceId, weekday: 3, startMinute: 900, endMinute: 1140 },
  ]);
  await api.db.insert(PaymentPackage).values([
    { practiceId, credits: 1, price: 300_000 },
    { practiceId, credits: 5, price: 1_400_000 },
  ]);
  await api.db.insert(Workflow).values({
    practiceId,
    trigger: "after_end",
    amount: 24,
    subject: "Спасибо",
    text: "Спасибо за встречу, {имя}",
  });

  const person = await createSession(api.db, {
    name: "Ольга Петрова",
    email: `olga-${crypto.randomUUID()}@people.test`,
    phone: "+79001112233",
  });
  const [olga] = await api.db
    .insert(PracticeMember)
    .values({
      practiceId,
      userId: person.user.id,
      role: "client",
      credits: 3,
    })
    .returning();
  if (!olga) throw new Error("no client");
  await api.db.insert(PracticeClient).values({
    practiceId,
    name: "Мария Смирнова",
    phone: "+79002223344",
    note: "Перенесена из таблицы",
    credits: 2,
  });

  const [series] = await api.db
    .insert(BookingSeries)
    .values({ practiceId, memberId: olga.id, intervalWeeks: 1, count: 2 })
    .returning();
  const at = (days: number, hours = 10) =>
    new Date(Math.floor(Date.now() / DAY + days) * DAY + hours * 3_600_000);
  const [past, , cancelled] = await api.db
    .insert(Booking)
    .values([
      {
        practiceId,
        kind: "consultation",
        memberId: olga.id,
        seriesId: series?.id,
        startsAt: at(-30),
        endsAt: at(-30, 11),
        note: "Первая встреча",
        answers: [{ question: "Что привело?", answer: "Тревога" }],
        clientTimezone: "Europe/Moscow",
      },
      {
        practiceId,
        kind: "consultation",
        memberId: olga.id,
        seriesId: series?.id,
        startsAt: at(5),
        endsAt: at(5, 11),
        meetingUrl: "https://company.ktalk.ru/olga",
      },
      {
        practiceId,
        kind: "consultation",
        memberId: olga.id,
        status: "cancelled",
        cancelReason: "no_show",
        cancelledAt: at(-10),
        startsAt: at(-10),
        endsAt: at(-10, 11),
      },
      {
        practiceId,
        kind: "free",
        guestName: "Гость Иванов",
        guestPhone: "+79003334455",
        guestContact: "@ivanov",
        startsAt: at(6),
        endsAt: at(6, 11),
      },
      {
        practiceId,
        kind: "blocked",
        note: "Отпуск",
        startsAt: at(7),
        endsAt: at(8),
      },
    ])
    .returning();

  const [merchant] = await api.db
    .insert(PaymentAccount)
    .values({
      practiceId,
      provider: "yookassa",
      merchantId: "shop",
      secret: "encrypted-secret",
    })
    .returning();
  if (!merchant) throw new Error("no merchant");
  const [payment] = await api.db
    .insert(Payment)
    .values({
      practiceId,
      accountId: merchant.id,
      memberId: olga.id,
      bookingId: past?.id,
      provider: "yookassa",
      externalId: `ext-${crypto.randomUUID().slice(0, 8)}`,
      status: "succeeded",
      credits: 5,
      amount: 1_400_000,
      paidAt: at(-31),
    })
    .returning();
  await api.db.insert(CreditEntry).values([
    {
      memberId: olga.id,
      delta: 5,
      reason: "purchase",
      paymentId: payment?.id,
    },
    { memberId: olga.id, delta: -1, reason: "booking", bookingId: past?.id },
    {
      memberId: olga.id,
      delta: 1,
      reason: "refund",
      bookingId: cancelled?.id,
      note: "Вернули",
    },
  ]);
  await api.db.insert(OfflinePayment).values({
    practiceId,
    memberId: olga.id,
    bookingId: past?.id,
    amount: 350_000,
    method: "cash",
    paidAt: at(-30),
    note: "Наличными на приёме",
  });
  const [document] = await api.db
    .insert(PracticeDocument)
    .values({ practiceId, kind: "personal_data", required: true })
    .returning();
  if (!document) throw new Error("no document");
  const [version] = await api.db
    .insert(PracticeDocumentVersion)
    .values({
      documentId: document.id,
      number: 1,
      title: "Согласие на обработку данных",
      body: "Согласен на обработку персональных данных.",
    })
    .returning();
  if (!version) throw new Error("no version");
  await api.db.insert(Consent).values({
    practiceId,
    memberId: olga.id,
    versionId: version.id,
    bookingId: past?.id,
    acceptedAt: at(-31),
    ip: "203.0.113.7",
    userAgent: "TestBrowser/1.0",
  });
  return source;
}

/**
 * The practice with what can't and shouldn't survive taken out: ids (remapped),
 * the address, and the specialist's own account, team and merchant accounts,
 * which belong to the account it's loaded into. Clients with a cabinet become
 * cards, so both lists read as one, by who they are.
 */
function canonical(dump: AccountDump) {
  const practice = dump.practices[0];
  if (!practice) throw new Error("no practice in dump");
  const people = [...practice.clients, ...practice.imported_clients];
  const who = (id: string | null | undefined) => {
    if (!id) return null;
    return people.find((person) => person.id === id)?.name ?? "team";
  };
  const bookingAt = (id: string | null | undefined) =>
    practice.bookings.find((row) => row.id === id)?.starts_at ?? null;
  // Key order of a JSON object means nothing, and archived rows keep none.
  const stable = (row: object) =>
    JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
  const sorted = (rows: object[]) => rows.map(stable).sort();

  return {
    settings: {
      name: practice.name,
      timezone: practice.timezone,
      profession: practice.profession,
      video_url: practice.video_url,
      client_contact: practice.client_contact,
      booking_questions: practice.booking_questions,
      // Unset keys mean the default, stored or not.
      booking_theme: readBookingTheme(practice.booking_theme),
      free_booking_enabled: practice.free_booking_enabled,
      intro_minutes: practice.intro_minutes,
      remind_clients: practice.remind_clients,
      notify_staff: practice.notify_staff,
      daily_agenda: practice.daily_agenda,
    },
    working_hours: sorted(practice.working_hours),
    packages: sorted(practice.packages),
    messages: sorted(practice.messages),
    people: sorted(
      people.map((person) => ({
        name: person.name,
        phone: person.phone,
        email: person.email,
        credits: person.credits,
        note: "note" in person ? person.note : null,
      })),
    ),
    series: sorted(
      practice.series.map((row) => ({
        client: who(row.client_id),
        interval: row.interval_weeks,
        count: row.count,
        cancelled_at: row.cancelled_at,
        created_at: row.created_at,
      })),
    ),
    bookings: sorted(
      practice.bookings.map(({ id: _, series_id, client_id, ...row }) => ({
        ...row,
        client: who(client_id),
        in_series: series_id !== null,
      })),
    ),
    payments: sorted(
      practice.payments.map(({ id: _, client_id, booking_id, ...row }) => ({
        ...row,
        client: who(client_id),
        booking: bookingAt(booking_id),
      })),
    ),
    documents: sorted(
      practice.documents
        .filter((document) => !document.archived)
        .map((document) => {
          const latest = document.versions.at(-1);
          return {
            kind: document.kind,
            required: document.required,
            title: latest?.title,
            text: latest?.text,
          };
        }),
    ),
    consents: sorted(
      practice.consents.map(
        ({ id: _, client_id, booking_id, version_id: _version, ...row }) => ({
          ...row,
          client: who(client_id),
          booking: bookingAt(booking_id),
        }),
      ),
    ),
    offline_payments: sorted(
      practice.offline_payments.map(
        ({ id: _, client_id, booking_id, credit_entry_id, ...row }) => ({
          ...row,
          client: who(client_id),
          booking: bookingAt(booking_id),
          package: credit_entry_id !== null,
        }),
      ),
    ),
    credit_entries: sorted(
      practice.credit_entries.map(
        ({ id: _, client_id, booking_id, payment_id, ...row }) => ({
          ...row,
          client: who(client_id),
          booking: bookingAt(booking_id),
          paid: payment_id !== null,
        }),
      ),
    ),
  };
}

async function restore(
  target: Awaited<ReturnType<typeof makeOwner>>,
  content: string | Uint8Array,
  archivePractice = 0,
) {
  const uploaded = await call(
    importRouter.upload,
    {
      practiceId: target.practice.id,
      file: new File(
        [typeof content === "string" ? strToU8(content) : content],
        "data.json",
      ),
    },
    target.context,
  );
  if (uploaded.kind !== "archive") throw new Error("not an archive");
  const committed = await call(
    importRouter.commit,
    {
      batchId: uploaded.id,
      archivePractice,
      duplicates: "skip",
      importNotes: true,
      consent: true,
    },
    target.context,
  );
  return { uploaded, committed };
}

describe("the round trip", () => {
  it("export → import into a clean account → export gives the same data", async () => {
    const source = await richPractice();
    const first = await collectAccount(api.db, source.session.user.id);

    const target = await makeOwner();
    const { committed } = await restore(target, JSON.stringify(first));
    expect(committed.status).toBe("applied");

    const second = await collectAccount(api.db, target.session.user.id);
    expect(canonical(second)).toEqual(canonical(first));
    // And it holds up going around again.
    const third = await makeOwner();
    await restore(third, JSON.stringify(second));
    const again = await collectAccount(api.db, third.session.user.id);
    expect(canonical(again)).toEqual(canonical(first));
  });

  it("takes the ZIP as it was downloaded", async () => {
    const source = await richPractice();
    const dump = await collectAccount(api.db, source.session.user.id);
    const target = await makeOwner();
    const zip = zipSync({
      "data.json": strToU8(JSON.stringify(dump)),
      "README.txt": strToU8("x"),
    });
    const { committed } = await restore(target, zip);
    expect(committed.status).toBe("applied");
    const second = await collectAccount(api.db, target.session.user.id);
    expect(canonical(second)).toEqual(canonical(dump));
  });

  it("undoes all of it, and the practice is as it was", async () => {
    const source = await richPractice();
    const dump = await collectAccount(api.db, source.session.user.id);
    const target = await makeOwner();
    const before = await collectAccount(api.db, target.session.user.id);

    const { uploaded } = await restore(target, JSON.stringify(dump));
    await call(importRouter.undo, { batchId: uploaded.id }, target.context);

    const after = await collectAccount(api.db, target.session.user.id);
    expect(canonical(after)).toEqual(canonical(before));
  });
});

describe("undoing an import whose documents were accepted since", () => {
  it("keeps what a client accepted: the document is put away, not deleted", async () => {
    const source = await richPractice();
    const dump = await collectAccount(api.db, source.session.user.id);
    const target = await makeOwner();
    const { uploaded } = await restore(target, JSON.stringify(dump));

    const imported = await api.db.query.PracticeDocument.findFirst({
      where: eq(PracticeDocument.practiceId, target.practice.id),
    });
    if (!imported) throw new Error("the import brought no document");
    const version = await api.db.query.PracticeDocumentVersion.findFirst({
      where: eq(PracticeDocumentVersion.documentId, imported.id),
    });
    if (!version) throw new Error("no version");
    const client = await createSession(api.db);
    const [member] = await api.db
      .insert(PracticeMember)
      .values({ practiceId: target.practice.id, userId: client.user.id })
      .returning();
    await api.db.insert(Consent).values({
      practiceId: target.practice.id,
      memberId: member?.id ?? "",
      versionId: version.id,
      bySession: true,
    });

    await call(importRouter.undo, { batchId: uploaded.id }, target.context);

    expect(
      await api.db.$count(Consent, eq(Consent.practiceId, target.practice.id)),
    ).toBe(1);
    const stored = await api.db.query.PracticeDocument.findFirst({
      where: eq(PracticeDocument.id, imported.id),
    });
    expect(stored?.archived).toBe(true);
  });
});

describe("an archive with more documents than a practice may ask", () => {
  it("brings the first five and leaves the rest behind", async () => {
    const source = await makeOwner();
    const dump = await collectAccount(api.db, source.session.user.id);
    const forged = structuredClone(dump);
    forged.practices[0]?.documents.push(
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `d${index}`,
        kind: "other" as const,
        required: true,
        archived: false,
        versions: [
          {
            id: `v${index}`,
            number: 1,
            title: `Документ ${index + 1}`,
            text: "Текст",
            created_at: null,
          },
        ],
      })),
    );
    const target = await makeOwner();
    await restore(target, JSON.stringify(forged));

    expect(
      await api.db.$count(
        PracticeDocument,
        eq(PracticeDocument.practiceId, target.practice.id),
      ),
    ).toBe(5);
  });
});

describe("an attempt that stopped halfway", () => {
  it("is picked up without doubling cards that have no contacts", async () => {
    const source = await makeOwner();
    await api.db.insert(PracticeClient).values([
      { practiceId: source.practice.id, name: "Без контактов 1" },
      { practiceId: source.practice.id, name: "Без контактов 2" },
    ]);
    const dump = await collectAccount(api.db, source.session.user.id);

    const target = await makeOwner();
    const { uploaded } = await restore(target, JSON.stringify(dump));
    // A rerun, as Hatchet makes after a crash.
    await api.db
      .update(ImportBatch)
      .set({ status: "applying" })
      .where(eq(ImportBatch.id, uploaded.id));
    await runImport(api.db, uploaded.id);

    const cards = await api.db
      .select({ name: PracticeClient.name })
      .from(PracticeClient)
      .where(eq(PracticeClient.practiceId, target.practice.id));
    expect(cards.map((row) => row.name).sort()).toEqual([
      "Без контактов 1",
      "Без контактов 2",
    ]);
  });

  it("stays open for the retry, and fails only on the last attempt", async () => {
    const target = await makeOwner();
    const uploaded = await call(
      importRouter.upload,
      {
        practiceId: target.practice.id,
        file: new File([strToU8("Имя\nАнна\n")], "a.csv"),
      },
      target.context,
    );
    // The file is gone, so the attempt fails.
    await api.db.delete(ImportFile).where(eq(ImportFile.batchId, uploaded.id));
    await api.db
      .update(ImportBatch)
      .set({
        status: "applying",
        options: {
          mapping: ["name"],
          duplicates: "skip",
          importNotes: false,
        },
      })
      .where(eq(ImportBatch.id, uploaded.id));
    const status = async () =>
      (
        await api.db.query.ImportBatch.findFirst({
          where: eq(ImportBatch.id, uploaded.id),
        })
      )?.status;

    await expect(
      runImport(api.db, uploaded.id, { final: false }),
    ).rejects.toThrow();
    expect(await status()).toBe("applying");
    await expect(
      runImport(api.db, uploaded.id, { final: true }),
    ).rejects.toThrow();
    expect(await status()).toBe("failed");
  });

  it("is marked failed if the worker never came back", async () => {
    const target = await makeOwner();
    const uploaded = await call(
      importRouter.upload,
      {
        practiceId: target.practice.id,
        file: new File([strToU8("Имя\nАнна\n")], "a.csv"),
      },
      target.context,
    );
    await api.db
      .update(ImportBatch)
      .set({ status: "applying" })
      .where(eq(ImportBatch.id, uploaded.id));
    await cleanupImports(api.db, new Date(Date.now() + 2 * 3_600_000));
    const batch = await api.db.query.ImportBatch.findFirst({
      where: eq(ImportBatch.id, uploaded.id),
    });
    expect(batch?.status).toBe("failed");
  });
});

describe("undoing with changes made since", () => {
  it("puts back only the settings nobody touched after the import", async () => {
    const source = await richPractice();
    const dump = await collectAccount(api.db, source.session.user.id);
    const target = await makeOwner();
    const { uploaded } = await restore(target, JSON.stringify(dump));

    await api.db
      .update(Practice)
      .set({ clientContact: "Новый контакт, после импорта" })
      .where(eq(Practice.id, target.practice.id));
    await call(importRouter.undo, { batchId: uploaded.id }, target.context);

    const stored = await api.db.query.Practice.findFirst({
      where: eq(Practice.id, target.practice.id),
    });
    expect(stored?.clientContact).toBe("Новый контакт, после импорта");
    expect(stored?.name).toBe("Новая практика");
    expect(stored?.timezone).toBe("Europe/Moscow");
  });
});

describe("what an archive can't do", () => {
  it("attaches nobody, whatever addresses it names", async () => {
    const stranger = await createSession(api.db, {
      name: "Настоящий человек",
      email: "real@person.org",
      phone: "+79005556677",
    });
    const source = await makeOwner();
    const dump = await collectAccount(api.db, source.session.user.id);
    const forged = structuredClone(dump);
    forged.practices[0]?.clients.push({
      id: "x",
      name: "Подделка",
      email: "real@person.org",
      phone: "+79005556677",
      credits: 100,
      created_at: null,
    });
    const target = await makeOwner();
    await restore(target, JSON.stringify(forged));

    const joined = await api.db
      .select()
      .from(PracticeMember)
      .where(eq(PracticeMember.userId, stranger.user.id));
    expect(joined).toEqual([]);
    const unchanged = await api.db.query.user.findFirst({
      where: eq(user.id, stranger.user.id),
    });
    expect(unchanged?.name).toBe("Настоящий человек");
  });

  it("doesn't pass on what wouldn't pass the forms", async () => {
    const source = await makeOwner();
    const dump = await collectAccount(api.db, source.session.user.id);
    const forged = structuredClone(dump);
    const row = forged.practices[0];
    if (!row) throw new Error("no practice");
    row.video_url = "javascript:alert(1)";
    row.booking_questions = [{ nonsense: true }] as never;
    row.booking_theme = { accent: "<script>" } as never;
    const target = await makeOwner();
    await restore(target, JSON.stringify(forged));

    const stored = await api.db.query.Practice.findFirst({
      where: eq(Practice.id, target.practice.id),
    });
    expect(stored?.videoUrl).toBeNull();
    expect(stored?.bookingQuestions).toEqual([]);
    expect(stored?.bookingTheme.accent).not.toBe("<script>");
  });

  it("won't take history that would break the next export", async () => {
    const source = await makeOwner();
    const dump = await collectAccount(api.db, source.session.user.id);
    const forged = structuredClone(dump) as unknown as {
      practices: { payments: unknown[] }[];
    };
    forged.practices[0]?.payments.push({
      id: "x",
      provider: "yookassa",
      status: "succeeded",
      credits: 1,
      amount_kopecks: 100,
      paid_at: "not-a-date",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const target = await makeOwner();
    await expect(restore(target, JSON.stringify(forged))).rejects.toMatchObject(
      { code: "FILE_PROBLEM" },
    );
  });

  it("sizes the job by the practice picked, not the number of practices", async () => {
    const source = await makeOwner();
    await api.db.insert(PracticeClient).values(
      Array.from({ length: 3 }, (_, index) => ({
        practiceId: source.practice.id,
        name: `Клиент ${index}`,
      })),
    );
    const dump = await collectAccount(api.db, source.session.user.id);
    const target = await makeOwner();
    const { uploaded } = await restore(target, JSON.stringify(dump));
    const batch = await api.db.query.ImportBatch.findFirst({
      where: eq(ImportBatch.id, uploaded.id),
    });
    expect(batch?.rowCount).toBe(3);
  });

  it("takes as many working hours as the form allows", async () => {
    const source = await makeOwner();
    const dump = await collectAccount(api.db, source.session.user.id);
    const row = dump.practices[0];
    if (!row) throw new Error("no practice");
    row.working_hours = Array.from({ length: 168 }, (_, index) => ({
      weekday: (index % 7) + 1,
      start_minute: (index % 24) * 60,
      end_minute: (index % 24) * 60 + 30,
    }));
    const target = await makeOwner();
    const { committed } = await restore(target, JSON.stringify(dump));
    expect(committed.status).toBe("applied");
    const stored = await api.db
      .select()
      .from(AvailabilityRule)
      .where(eq(AvailabilityRule.practiceId, target.practice.id));
    expect(stored).toHaveLength(168);
  });

  it("refuses a version it would spend forever walking up from", async () => {
    const target = await makeOwner();
    const started = Date.now();
    await expect(
      call(
        importRouter.upload,
        {
          practiceId: target.practice.id,
          file: new File(
            [strToU8('{"format_version":-1000000000000000,"practices":[]}')],
            "data.json",
          ),
        },
        target.context,
      ),
    ).rejects.toMatchObject({ code: "FILE_PROBLEM" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("refuses what isn't ours, and what's from the future", async () => {
    const target = await makeOwner();
    const upload = (content: string) =>
      call(
        importRouter.upload,
        {
          practiceId: target.practice.id,
          file: new File([strToU8(content)], "data.json"),
        },
        target.context,
      );
    await expect(upload('{"hello":"world"}')).rejects.toMatchObject({
      code: "FILE_PROBLEM",
    });
    await expect(
      upload('{"format_version":99,"practices":[]}'),
    ).rejects.toMatchObject({ code: "FILE_PROBLEM" });
    await expect(
      upload('{"format_version":1,"practices":[{"name":""}]}'),
    ).rejects.toMatchObject({ code: "FILE_PROBLEM" });
  });

  it("leaves the settings alone in a practice that's already in use", async () => {
    const source = await richPractice();
    const dump = await collectAccount(api.db, source.session.user.id);
    const target = await makeOwner();
    await api.db.insert(PracticeClient).values({
      practiceId: target.practice.id,
      name: "Уже здесь",
    });
    await restore(target, JSON.stringify(dump));

    const stored = await api.db.query.Practice.findFirst({
      where: eq(Practice.id, target.practice.id),
    });
    expect(stored?.name).toBe("Новая практика");
    const cards = await api.db
      .select({ name: PracticeClient.name })
      .from(PracticeClient)
      .where(eq(PracticeClient.practiceId, target.practice.id));
    expect(cards.map((row) => row.name).sort()).toEqual([
      "Мария Смирнова",
      "Ольга Петрова",
      "Уже здесь",
    ]);
  });

  it("is told what would come, before anything does", async () => {
    const source = await richPractice();
    const dump = await collectAccount(api.db, source.session.user.id);
    const target = await makeOwner();
    const uploaded = await call(
      importRouter.upload,
      {
        practiceId: target.practice.id,
        file: new File([strToU8(JSON.stringify(dump))], "data.json"),
      },
      target.context,
    );
    if (uploaded.kind !== "archive") throw new Error("not an archive");
    expect(uploaded.practices[0]).toEqual({
      name: "Практика Анны",
      clients: 2,
      bookings: 5,
    });
    const seen = await call(
      importRouter.previewArchive,
      { batchId: uploaded.id, practiceIndex: 0 },
      target.context,
    );
    expect(seen).toMatchObject({
      clean: true,
      clients: 2,
      bookings: 5,
      payments: 1,
      creditEntries: 3,
      hours: 2,
      packages: 2,
      messages: 1,
    });
    const rows = await api.db
      .select()
      .from(PracticeClient)
      .where(eq(PracticeClient.practiceId, target.practice.id));
    expect(rows).toEqual([]);
  });
});

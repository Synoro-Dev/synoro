import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import {
  and,
  DataAuditEntry,
  eq,
  ImportBatch,
  ImportFile,
  Practice,
  PracticeClient,
  PracticeMember,
  SentNotice,
  type user,
} from "@synoro/db";
import { collectAccount } from "@synoro/jobs/data-export";
import {
  cleanupImports,
  detectKind,
  readTable,
} from "@synoro/jobs/data-import";
import { sendWorkflowMessages } from "@synoro/jobs/workflow-messages";
import { suggestMapping } from "@synoro/validators";
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
  const session = await createSession(api.db);
  const [practice] = await api.db
    .insert(Practice)
    .values({
      name: "Практика",
      slug: `p-${crypto.randomUUID().slice(0, 8)}`,
      ownerId: session.user.id,
    })
    .returning();
  if (!practice) throw new Error("no practice");
  await api.db.insert(PracticeMember).values({
    practiceId: practice.id,
    userId: session.user.id,
    role: "owner",
  });
  return { session, practice, context: { context: api.context(session) } };
}

function cp1251(text: string) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x401) out[i] = 0xa8;
    else if (code === 0x451) out[i] = 0xb8;
    else if (code >= 0x410 && code <= 0x44f) out[i] = code - 0x350;
    else out[i] = code;
  }
  return out;
}

function fileOf(content: string | Uint8Array, name = "clients.csv") {
  const bytes = typeof content === "string" ? strToU8(content) : content;
  return new File([bytes], name);
}

function xlsx(rows: string[][]) {
  const shared: string[] = [];
  const cell = (value: string, column: number, row: number) => {
    shared.push(value);
    const letter = String.fromCharCode(65 + column);
    return `<c r="${letter}${row}" t="s"><v>${shared.length - 1}</v></c>`;
  };
  const sheet = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells.map((value, c) => cell(value, c, r + 1)).join("")}</row>`,
    )
    .join("");
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst>${shared
        .map((value) => `<si><t>${value.replace(/&/g, "&amp;")}</t></si>`)
        .join("")}</sst>`,
    ),
  });
}

async function cards(practiceId: string) {
  return api.db
    .select()
    .from(PracticeClient)
    .where(eq(PracticeClient.practiceId, practiceId))
    .orderBy(PracticeClient.name);
}

describe("reading a file", () => {
  it("reads Windows-1251 and finds the separator", () => {
    const table = readTable(
      cp1251("ФИО;Телефон\r\nИванова Анна;8 900 111-22-33\r\n"),
    );
    expect(table.encoding).toBe("windows-1251");
    expect(table.delimiter).toBe(";");
    expect(table.headers).toEqual(["ФИО", "Телефон"]);
    expect(table.rows[0]).toEqual(["Иванова Анна", "8 900 111-22-33"]);
  });

  it("takes a UTF-8 BOM, commas, tabs and quoted separators", () => {
    const bom = readTable(strToU8("﻿Имя,Почта\nАня,a@b.ru\n"));
    expect(bom.encoding).toBe("utf-8");
    expect(bom.headers).toEqual(["Имя", "Почта"]);

    const tabs = readTable(strToU8("Имя\tТелефон\nАня\t+79001112233\n"));
    expect(tabs.delimiter).toBe("\t");

    const quoted = readTable(strToU8('Имя;Заметка\n"Петрова; Анна";"a\nb"\n'));
    expect(quoted.rows[0]).toEqual(["Петрова; Анна", "a\nb"]);
  });

  it("skips blank lines and keeps the line numbers true", () => {
    const table = readTable(strToU8("Имя;Тел\n\nАня;1\n;\nОля;2\n"));
    expect(table.rows.map((row) => row[0])).toEqual(["Аня", "Оля"]);
    expect(table.lines).toEqual([3, 5]);
  });

  it("reads a workbook, sparse cells and numbers in E notation", () => {
    const table = readTable(
      xlsx([
        ["Имя", "Телефон"],
        ["Анна & Ко", "+79001112233"],
      ]),
    );
    expect(table.rows[0]).toEqual(["Анна & Ко", "+79001112233"]);

    const sparse = zipSync({
      "xl/workbook.xml": strToU8("<workbook/>"),
      "xl/worksheets/sheet1.xml": strToU8(
        '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Имя</t></is></c><c r="C1" t="inlineStr"><is><t>Тел</t></is></c></row><row r="2"><c r="C2"><v>7.9001112233E10</v></c></row></sheetData>',
      ),
    });
    const read = readTable(sparse);
    expect(read.headers).toEqual(["Имя", "", "Тел"]);
    expect(read.rows[0]).toEqual(["", "", "79001112233"]);
  });

  it("refuses what isn't a table, whatever it's called", () => {
    expect(() => readTable(new Uint8Array([0x89, 0x50, 0, 0, 1]))).toThrow(
      "не похоже на таблицу",
    );
    expect(() => readTable(zipSync({ "a.txt": strToU8("x") }))).toThrow(
      "архив",
    );
    expect(() => readTable(new Uint8Array())).toThrow("пустой");
    expect(detectKind(strToU8("BEGIN:VCALENDAR\r\n"))).toBe("ics");
    expect(detectKind(strToU8('{"format_version":1}'))).toBe("json");
  });

  it("refuses a ZIP that unpacks to too much", () => {
    const bomb = zipSync({
      "xl/workbook.xml": strToU8("<workbook/>"),
      "xl/worksheets/sheet1.xml": new Uint8Array(120 * 1024 * 1024),
    });
    expect(bomb.length).toBeLessThan(10 * 1024 * 1024);
    expect(() => readTable(bomb)).toThrow("слишком большой");
  });
});

describe("guessing columns", () => {
  it("knows Russian and English headers, whatever the case", () => {
    expect(
      suggestMapping(["ФИО", "Телефон", "E-mail", "Комментарий", "Город"]),
    ).toEqual(["name", "phone", "email", "note", null]);
    expect(suggestMapping(["Full Name", "Phone", "Email"])).toEqual([
      "name",
      "phone",
      "email",
    ]);
    expect(suggestMapping(["Фамилия", "Имя", "Отчество"])).toEqual([
      "lastName",
      "firstName",
      "middleName",
    ]);
  });

  it("knows the usual words of other booking services", () => {
    expect(
      suggestMapping([
        "Имя клиента",
        "Телефон клиента",
        "Email клиента",
        "Комментарий к клиенту",
        "Сумма оплат",
      ]),
    ).toEqual(["name", "phone", "email", "note", null]);
  });

  it("reads a lone «Имя» as the whole name, and each field once", () => {
    expect(suggestMapping(["Имя", "Тел"])).toEqual(["name", "phone"]);
    expect(suggestMapping(["Телефон", "Мобильный"])).toEqual(["phone", null]);
  });
});

describe("the wizard", () => {
  const CSV = [
    "ФИО;Телефон;Почта;Комментарий;Лишняя",
    "Иванова Анна;8 (900) 111-22-33;ANNA@Mail.ru;тревожность;x",
    "Петрова Ольга;+7 900 222-33-44;;;y",
    "Сидорова Мария;не знаю;;;z",
    ";;;;",
    "Без контакта;;;;",
    ";9001234567;;;",
    "Иванова А.;89001112233;;;дубль в файле",
  ].join("\r\n");

  async function start(content: string | Uint8Array = CSV) {
    const owner = await makeOwner();
    const uploaded = await call(
      importRouter.upload,
      { practiceId: owner.practice.id, file: fileOf(content) },
      owner.context,
    );
    return { ...owner, uploaded };
  }

  it("previews without writing anything", async () => {
    const { practice, uploaded, context } = await start();
    expect(uploaded.mapping).toEqual(["name", "phone", "email", "note", null]);
    expect(uploaded.sample[0]?.[0]).toBe("Иванова Анна");

    const seen = await call(
      importRouter.preview,
      { batchId: uploaded.id, mapping: uploaded.mapping },
      context,
    );
    expect(seen.added).toBe(3);
    expect(seen.duplicates.total).toBe(1);
    expect(seen.duplicates.samples[0]).toMatchObject({
      name: "Иванова А.",
      by: "phone",
      kind: "file",
    });
    expect(seen.errors.total).toBe(2);
    expect(seen.errors.samples).toEqual([
      { line: 4, reasons: ["не распознан телефон «не знаю»"] },
      { line: 7, reasons: ["нет имени"] },
    ]);
    expect(seen.notes).toBe(1);
    expect(await cards(practice.id)).toEqual([]);
  });

  it("normalizes on the way in, and leaves notes out unless asked", async () => {
    const { practice, uploaded, context } = await start();
    const result = await call(
      importRouter.commit,
      {
        batchId: uploaded.id,
        mapping: uploaded.mapping,
        duplicates: "skip",
        importNotes: false,
        consent: true,
      },
      context,
    );
    expect(result.status).toBe("applied");
    expect(result.totals).toEqual({
      added: 3,
      merged: 0,
      skipped: 1,
      errors: 2,
    });

    const rows = await cards(practice.id);
    expect(rows.map((row) => row.name)).toEqual([
      "Без контакта",
      "Иванова Анна",
      "Петрова Ольга",
    ]);
    const anna = rows[1];
    expect(anna?.phone).toBe("+79001112233");
    expect(anna?.email).toBe("anna@mail.ru");
    expect(anna?.note).toBeNull();
  });

  it("takes notes when asked", async () => {
    const { practice, uploaded, context } = await start();
    await call(
      importRouter.commit,
      {
        batchId: uploaded.id,
        mapping: uploaded.mapping,
        duplicates: "skip",
        importNotes: true,
        consent: true,
      },
      context,
    );
    const rows = await cards(practice.id);
    expect(rows.find((row) => row.name === "Иванова Анна")?.note).toBe(
      "тревожность",
    );
  });

  it("gives the bad rows back as a table to fix", async () => {
    const { uploaded, context } = await start();
    const { csv } = await call(
      importRouter.rejected,
      { batchId: uploaded.id, mapping: uploaded.mapping },
      context,
    );
    expect(csv).toContain("ФИО;Телефон;Почта;Комментарий;Лишняя;Ошибка");
    expect(csv).toContain("Сидорова Мария;не знаю;;;z;не распознан телефон");
    expect(csv).not.toContain("Петрова");
    // It's a table we can read back, with the same columns.
    const again = readTable(strToU8(csv));
    expect(again.rows).toHaveLength(2);
  });

  it("won't apply twice", async () => {
    const { uploaded, context } = await start();
    const input = {
      batchId: uploaded.id,
      mapping: uploaded.mapping,
      duplicates: "skip" as const,
      importNotes: false,
      consent: true as const,
    };
    await call(importRouter.commit, input, context);
    await expect(
      call(importRouter.commit, input, context),
    ).rejects.toMatchObject({ code: "ALREADY_APPLIED" });
  });

  it("wants a name column", async () => {
    const { uploaded, context } = await start();
    await expect(
      call(
        importRouter.preview,
        { batchId: uploaded.id, mapping: [null, "phone", null, null, null] },
        context,
      ),
    ).rejects.toThrow();
  });

  it("is the owner's alone", async () => {
    const { practice, uploaded } = await start();
    const helper = await createSession(api.db);
    await api.db.insert(PracticeMember).values({
      practiceId: practice.id,
      userId: helper.user.id,
      role: "admin",
    });
    const context = { context: api.context(helper) };
    await expect(
      call(
        importRouter.upload,
        { practiceId: practice.id, file: fileOf(CSV) },
        context,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(
        importRouter.preview,
        { batchId: uploaded.id, mapping: uploaded.mapping },
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(importRouter.undo, { batchId: uploaded.id }, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        importRouter.rejected,
        { batchId: uploaded.id, mapping: uploaded.mapping },
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Staff still see the cards themselves.
    expect(
      await call(importRouter.clients, { practiceId: practice.id }, context),
    ).toEqual([]);
  });
});

describe("duplicates", () => {
  async function imported(
    content: string,
    duplicates: "merge" | "skip",
    owner: Awaited<ReturnType<typeof makeOwner>>,
  ) {
    const uploaded = await call(
      importRouter.upload,
      { practiceId: owner.practice.id, file: fileOf(content) },
      owner.context,
    );
    return call(
      importRouter.commit,
      {
        batchId: uploaded.id,
        mapping: uploaded.mapping,
        duplicates,
        importNotes: true,
        consent: true,
      },
      owner.context,
    );
  }

  it("skips a known card, or fills in only what it lacks", async () => {
    const owner = await makeOwner();
    await imported("Имя;Телефон\nАнна;89001112233\n", "skip", owner);

    const repeat = "Имя;Телефон;Почта\nАнна И.;89001112233;a@b.ru\n";
    const skipped = await imported(repeat, "skip", owner);
    expect(skipped.totals).toMatchObject({ added: 0, merged: 0, skipped: 1 });
    expect((await cards(owner.practice.id))[0]?.email).toBeNull();

    const merged = await imported(repeat, "merge", owner);
    expect(merged.totals).toMatchObject({ added: 0, merged: 1 });
    const [card, ...rest] = await cards(owner.practice.id);
    expect(rest).toEqual([]);
    expect(card?.email).toBe("a@b.ru");
    // What the specialist already had stays.
    expect(card?.name).toBe("Анна");
  });

  it("matches by email too, and repeats inside the file", async () => {
    const owner = await makeOwner();
    await imported(
      "Имя;Почта\nАнна;A@B.ru\nАня;a@b.ru\nОля;o@b.ru\n",
      "merge",
      owner,
    );
    const rows = await cards(owner.practice.id);
    expect(rows.map((row) => row.name)).toEqual(["Анна", "Оля"]);
  });

  it("leaves clients with a cabinet alone, even when merging", async () => {
    const owner = await makeOwner();
    const client = await createSession(api.db, {
      name: "С кабинетом",
      phone: "+79009998877",
    });
    await api.db.insert(PracticeMember).values({
      practiceId: owner.practice.id,
      userId: client.user.id,
      role: "client",
    });
    const result = await imported(
      "Имя;Телефон;Почта\nКто-то другой;89009998877;evil@b.ru\n",
      "merge",
      owner,
    );
    expect(result.totals).toMatchObject({ added: 0, merged: 0, skipped: 1 });
    expect(await cards(owner.practice.id)).toEqual([]);
    const stored = await api.db.query.user.findFirst({
      where: (table: typeof user, { eq }) => eq(table.id, client.user.id),
    });
    expect(stored?.name).toBe("С кабинетом");
  });

  it("never attaches someone's account by an imported address", async () => {
    const owner = await makeOwner();
    const stranger = await createSession(api.db, { email: "real@person.ru" });
    await imported("Имя;Почта\nПодставной;real@person.ru\n", "merge", owner);
    const membership = await api.db.query.PracticeMember.findFirst({
      where: and(
        eq(PracticeMember.practiceId, owner.practice.id),
        eq(PracticeMember.userId, stranger.user.id),
      ),
    });
    expect(membership).toBeUndefined();
    expect((await cards(owner.practice.id))[0]?.name).toBe("Подставной");
  });
});

describe("undoing", () => {
  async function apply(
    owner: Awaited<ReturnType<typeof makeOwner>>,
    content: string,
    duplicates: "merge" | "skip" = "merge",
  ) {
    const uploaded = await call(
      importRouter.upload,
      { practiceId: owner.practice.id, file: fileOf(content) },
      owner.context,
    );
    await call(
      importRouter.commit,
      {
        batchId: uploaded.id,
        mapping: uploaded.mapping,
        duplicates,
        importNotes: true,
        consent: true,
      },
      owner.context,
    );
    return uploaded.id;
  }

  it("removes exactly what the batch added and restores what it filled in", async () => {
    const owner = await makeOwner();
    await apply(owner, "Имя;Телефон\nПервая;89001110001\n");
    const second = await apply(
      owner,
      "Имя;Телефон;Почта\nПервая!;89001110001;first@b.ru\nВторая;89001110002;\n",
    );
    const before = await cards(owner.practice.id);
    expect(before.map((row) => row.name)).toEqual(["Вторая", "Первая"]);
    expect(before[1]?.email).toBe("first@b.ru");

    const { removed } = await call(
      importRouter.undo,
      { batchId: second },
      owner.context,
    );
    expect(removed).toBe(1);

    const after = await cards(owner.practice.id);
    expect(after.map((row) => row.name)).toEqual(["Первая"]);
    expect(after[0]?.email).toBeNull();

    const batch = await api.db.query.ImportBatch.findFirst({
      where: eq(ImportBatch.id, second),
    });
    expect(batch?.status).toBe("undone");
    expect(
      await api.db.query.ImportFile.findFirst({
        where: eq(ImportFile.batchId, second),
      }),
    ).toBeUndefined();
  });

  it("can't be done twice, and is in the journal", async () => {
    const owner = await makeOwner();
    const batch = await apply(owner, "Имя\nОдна\n");
    await call(importRouter.undo, { batchId: batch }, owner.context);
    await expect(
      call(importRouter.undo, { batchId: batch }, owner.context),
    ).rejects.toMatchObject({ code: "NOT_APPLIED" });

    const journal = await api.db
      .select({
        action: DataAuditEntry.action,
        details: DataAuditEntry.details,
      })
      .from(DataAuditEntry)
      .where(eq(DataAuditEntry.userId, owner.session.user.id));
    expect(journal.map((row) => row.action).sort()).toEqual([
      "import_applied",
      "import_undone",
    ]);
    // Counts, never what was in the file.
    expect(JSON.stringify(journal)).not.toContain("Одна");
  });
});

describe("what imported clients are spared", () => {
  it("gets no message, and goes into the export", async () => {
    const owner = await makeOwner();
    const uploaded = await call(
      importRouter.upload,
      {
        practiceId: owner.practice.id,
        file: fileOf("Имя;Телефон;Почта\nАнна;89001112233;anna@b.ru\n"),
      },
      owner.context,
    );
    await call(
      importRouter.commit,
      {
        batchId: uploaded.id,
        mapping: uploaded.mapping,
        duplicates: "skip",
        importNotes: false,
        consent: true,
      },
      owner.context,
    );

    const sent: unknown[] = [];
    await sendWorkflowMessages(api.db, async (message: unknown) => {
      sent.push(message);
    });
    expect(sent).toEqual([]);
    expect(
      await api.db
        .select()
        .from(SentNotice)
        .where(eq(SentNotice.userId, owner.session.user.id)),
    ).toEqual([]);

    const dump = await collectAccount(api.db, owner.session.user.id);
    expect(dump.practices[0]?.imported_clients[0]).toMatchObject({
      name: "Анна",
      phone: "+79001112233",
    });
  });

  it("drops a draft's file when its term is over", async () => {
    const owner = await makeOwner();
    const uploaded = await call(
      importRouter.upload,
      { practiceId: owner.practice.id, file: fileOf("Имя\nАнна\n") },
      owner.context,
    );
    await cleanupImports(api.db, new Date(Date.now() + 8 * 86_400_000));
    expect(
      await api.db.query.ImportFile.findFirst({
        where: eq(ImportFile.batchId, uploaded.id),
      }),
    ).toBeUndefined();
    const batch = await api.db.query.ImportBatch.findFirst({
      where: eq(ImportBatch.id, uploaded.id),
    });
    expect(batch?.status).toBe("expired");
  });
});

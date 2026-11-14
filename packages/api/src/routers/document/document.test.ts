import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Consent, eq, PracticeMember } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { availabilityRouter } from "../availability";
import { bookingRouter } from "../booking";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { documentRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;

// 2030-01-07 is a Monday; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const at = (utc: string) => new Date(`2030-01-07T${utc}:00Z`);
const HEADERS = {
  "x-forwarded-for": "203.0.113.7, 10.0.0.1",
  "user-agent": "TestBrowser/1.0",
};

type DocumentInput = {
  id?: string;
  kind: "offer" | "informed_consent" | "personal_data" | "other";
  title: string;
  body: string;
  required: boolean;
};

const save = (
  documents: DocumentInput[],
  acceptsMinors = false,
  session = owner,
) =>
  call(
    documentRouter.save,
    { practiceId, documents, acceptsMinors },
    { context: api.context(session) },
  );

const list = () =>
  call(documentRouter.list, { practiceId }, { context: api.context(owner) });

/** What the booking page gives a client: the documents with their versions. */
const page = async (session: Session | null = null) =>
  (
    await call(
      practiceRouter.bySlug,
      { slug: "anna-docs" },
      { context: api.context(session) },
    )
  ).documents;

async function newClient(credits = 5) {
  const session = await createSession(api.db);
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  await call(
    creditRouter.grant,
    { practiceId, memberId: member.id, delta: credits },
    { context: api.context(owner) },
  );
  return { session, memberId: member.id };
}

const book = (
  session: Session,
  startsAt: Date,
  consents?: {
    versionIds: string[];
    minor?: { representativeName: string; minorName: string };
  },
  memberId?: string,
) =>
  call(
    bookingRouter.book,
    { practiceId, startsAt, consents, memberId },
    { context: api.context(session, HEADERS) },
  );

const OFFER: DocumentInput = {
  kind: "offer",
  title: "Договор-оферта",
  body: "Условия оказания услуг.",
  required: true,
};
const DATA: DocumentInput = {
  kind: "personal_data",
  title: "Согласие на обработку персональных данных",
  body: "Согласен на обработку, включая сведения о здоровье.",
  required: true,
};
const NEWS: DocumentInput = {
  kind: "other",
  title: "Согласие на рассылку",
  body: "Хочу получать новости.",
  required: false,
};

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-docs", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  // Monday 10:00–20:00 MSK.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 1200 }] },
    { context: api.context(owner) },
  );
});

afterAll(async () => {
  await api.close();
});

describe("practice documents", () => {
  it("are the owner's to set, and nothing is asked without them", async () => {
    const { session } = await newClient();
    await expect(save([OFFER], false, session)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await page()).toEqual([]);
    await book(session, at("07:00"));
  });

  it("keep a version while the wording stays, and open a new one when it changes", async () => {
    await save([OFFER, DATA, NEWS]);
    const first = await list();
    expect(first.documents.map((d) => [d.title, d.version])).toEqual([
      [OFFER.title, 1],
      [DATA.title, 1],
      [NEWS.title, 1],
    ]);
    const withIds = first.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      body: d.body,
      required: d.required,
    }));

    // The same texts in another order: no new versions.
    await save([withIds[1], withIds[0], withIds[2]] as DocumentInput[]);
    const reordered = await list();
    expect(reordered.documents.map((d) => [d.title, d.version])).toEqual([
      [DATA.title, 1],
      [OFFER.title, 1],
      [NEWS.title, 1],
    ]);

    const before = (await page()).find((d) => d.kind === "offer");
    await save([
      { ...(withIds[0] as DocumentInput), body: "Новые условия." },
      withIds[1] as DocumentInput,
      withIds[2] as DocumentInput,
    ]);
    const after = (await page()).find((d) => d.kind === "offer");
    expect(after?.versionId).not.toBe(before?.versionId);
    expect((await list()).documents[0]).toMatchObject({
      version: 2,
      body: "Новые условия.",
    });

    // The wording a client accepted stays readable.
    const old = await call(
      documentRouter.read,
      { versionId: before?.versionId ?? "" },
      { context: api.context() },
    );
    expect(old).toMatchObject({ version: 1, body: OFFER.body });
  });
});

describe("consents when booking", () => {
  it("refuses a booking until every required document is accepted", async () => {
    const { session, memberId } = await newClient();
    const documents = await page(session);
    const required = documents.filter((d) => d.required);
    expect(required).toHaveLength(2);

    const error = await book(session, at("08:00"), {
      versionIds: [required[0]?.versionId ?? ""],
    }).catch((e) => e);
    expect(error).toMatchObject({
      code: "CONSENTS_REQUIRED",
      data: { documentIds: [required[1]?.id] },
    });
    expect(await api.db.$count(Consent, eq(Consent.memberId, memberId))).toBe(
      0,
    );

    const booking = await book(session, at("08:00"), {
      versionIds: required.map((d) => d.versionId),
    });
    const rows = await api.db
      .select()
      .from(Consent)
      .where(eq(Consent.memberId, memberId));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      practiceId,
      bookingId: booking.id,
      ip: "203.0.113.7",
      userAgent: "TestBrowser/1.0",
      representativeName: null,
    });

    // Accepted once: the next booking asks nothing, and the page knows.
    await book(session, at("09:00"));
    expect(
      (await page(session)).filter((d) => d.required).map((d) => d.accepted),
    ).toEqual([true, true]);
    expect(await api.db.$count(Consent, eq(Consent.memberId, memberId))).toBe(
      2,
    );
  });

  it("asks again for a new version only", async () => {
    const { session } = await newClient();
    const accept = async () =>
      (await page(session)).filter((d) => d.required).map((d) => d.versionId);
    await book(session, at("10:00"), { versionIds: await accept() });

    const current = (await list()).documents;
    await save(
      current.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        body: d.kind === "personal_data" ? `${d.body} Версия 2.` : d.body,
        required: d.required,
      })),
    );
    const changed = (await page(session)).find(
      (d) => d.kind === "personal_data",
    );
    const error = await book(session, at("11:00")).catch((e) => e);
    expect(error).toMatchObject({
      code: "CONSENTS_REQUIRED",
      data: { documentIds: [changed?.id] },
    });
    await book(session, at("11:00"), {
      versionIds: [changed?.versionId ?? ""],
    });
  });

  it("isn't asked of staff booking a client", async () => {
    const { memberId } = await newClient();
    await book(owner, at("12:00"), undefined, memberId);
    expect(await api.db.$count(Consent, eq(Consent.memberId, memberId))).toBe(
      0,
    );
  });

  it("takes a parent's consent for a child, apart from their own", async () => {
    const current = (await list()).documents;
    await save(
      current.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        body: d.body,
        required: d.required,
      })),
      true,
    );
    const { session, memberId } = await newClient();
    const versionIds = (await page(session))
      .filter((d) => d.required)
      .map((d) => d.versionId);
    await book(session, at("13:00"), { versionIds });

    const minor = { representativeName: "Ирина Петрова", minorName: "Миша" };
    // Their own consent doesn't cover the child.
    await expect(
      book(session, at("14:00"), { versionIds: [], minor }),
    ).rejects.toMatchObject({ code: "CONSENTS_REQUIRED" });
    await book(session, at("14:00"), { versionIds, minor });

    const given = await call(
      documentRouter.consents,
      { practiceId, memberId },
      { context: api.context(owner) },
    );
    expect(given).toHaveLength(4);
    expect(given.filter((c) => c.minorName === "Миша")).toHaveLength(2);
    expect(
      (await page(session))
        .filter((d) => d.required)
        .map((d) => [d.accepted, d.acceptedForMinor]),
    ).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it("asks a visitor booking the free intro, and records it for their new account", async () => {
    await call(
      practiceRouter.setFreeBooking,
      { practiceId, enabled: true },
      { context: api.context(owner) },
    );
    const guest = {
      name: "Гость",
      phone: "+7 900 555-20-20",
      email: "guest@docs.test",
    };
    const intro = (consents?: { versionIds: string[] }) =>
      call(
        bookingRouter.bookIntro,
        { practiceId, startsAt: at("15:00"), guest, consents },
        { context: api.context(null, HEADERS) },
      );
    await expect(intro()).rejects.toMatchObject({ code: "CONSENTS_REQUIRED" });
    await intro({
      versionIds: (await page())
        .filter((d) => d.required)
        .map((d) => d.versionId),
    });

    const [row] = await api.db
      .select({ ip: Consent.ip })
      .from(Consent)
      .innerJoin(PracticeMember, eq(PracticeMember.id, Consent.memberId))
      .where(eq(Consent.ip, "203.0.113.7"))
      .limit(1);
    expect(row?.ip).toBe("203.0.113.7");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, ClientNote, eq, PracticeMember } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { practiceRouter } from "../practice";
import { noteRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;

let owner: Session;
let admin: Session;
let client: Session;
let practiceId: string;
let memberId: string;
let bookingId: string;
let otherPracticeId: string;
let otherMemberId: string;

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDefinedError(error)) return error.code;
    throw error;
  }
  throw new Error("Expected a defined error");
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  admin = await createSession(api.db, { name: "Администратор" });
  client = await createSession(api.db, { name: "Борис" });

  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-notes", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  await api.db
    .insert(PracticeMember)
    .values({ practiceId, userId: admin.user.id, role: "admin" });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(client) },
  );
  memberId = member.id;

  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      memberId,
      startsAt: new Date("2030-01-07T07:00:00Z"),
      endsAt: new Date("2030-01-07T08:00:00Z"),
    })
    .returning({ id: Booking.id });
  if (!booking) throw new Error("No booking");
  bookingId = booking.id;

  const otherOwner = await createSession(api.db);
  const other = await call(
    practiceRouter.create,
    { name: "Другая", slug: "other-notes", profession: "psychologist" },
    { context: api.context(otherOwner) },
  );
  otherPracticeId = other.id;
  const otherMember = await call(
    practiceRouter.join,
    { practiceId: otherPracticeId },
    { context: api.context(client) },
  );
  otherMemberId = otherMember.id;
});

afterAll(async () => {
  await api.close();
});

describe("note", () => {
  it("keeps the owner's notes encrypted and gives them back newest first", async () => {
    const first = await call(
      noteRouter.create,
      { practiceId, memberId, body: "  Запрос: тревога на работе  " },
      { context: api.context(owner) },
    );
    expect(first.body).toBe("Запрос: тревога на работе");
    expect(first.bookingId).toBeNull();

    const second = await call(
      noteRouter.create,
      { practiceId, memberId, bookingId, body: "Первая сессия" },
      { context: api.context(owner) },
    );
    expect(second.bookingStartsAt).toEqual(new Date("2030-01-07T07:00:00Z"));

    const stored = await api.db.query.ClientNote.findFirst({
      where: eq(ClientNote.id, second.id),
    });
    expect(stored?.body).not.toContain("сессия");
    expect(stored?.body.startsWith("v1:")).toBe(true);

    const notes = await call(
      noteRouter.list,
      { practiceId, memberId },
      { context: api.context(owner) },
    );
    expect(notes.map((n) => n.body)).toEqual([
      "Первая сессия",
      "Запрос: тревога на работе",
    ]);
  });

  it("rewrites and deletes a note", async () => {
    const note = await call(
      noteRouter.create,
      { practiceId, memberId, body: "Черновик" },
      { context: api.context(owner) },
    );
    const updated = await call(
      noteRouter.update,
      { practiceId, noteId: note.id, body: "Исправлено" },
      { context: api.context(owner) },
    );
    expect(updated.body).toBe("Исправлено");

    await call(
      noteRouter.remove,
      { practiceId, noteId: note.id },
      { context: api.context(owner) },
    );
    const notes = await call(
      noteRouter.list,
      { practiceId, memberId },
      { context: api.context(owner) },
    );
    expect(notes.some((n) => n.id === note.id)).toBe(false);
  });

  it("is closed to administrators, clients and impersonation", async () => {
    for (const session of [admin, client]) {
      expect(
        await code(
          call(
            noteRouter.list,
            { practiceId, memberId },
            { context: api.context(session) },
          ),
        ),
      ).toBe("FORBIDDEN");
    }

    const impersonated: Session = {
      ...owner,
      session: { ...owner.session, impersonatedBy: admin.user.id },
    };
    expect(
      await code(
        call(
          noteRouter.list,
          { practiceId, memberId },
          { context: api.context(impersonated) },
        ),
      ),
    ).toBe("FORBIDDEN");
  });

  it("won't reach another practice's client, booking or note", async () => {
    expect(
      await code(
        call(
          noteRouter.create,
          { practiceId, memberId: otherMemberId, body: "Чужой" },
          { context: api.context(owner) },
        ),
      ),
    ).toBe("NOT_FOUND");

    const [foreignBooking] = await api.db
      .insert(Booking)
      .values({
        practiceId: otherPracticeId,
        kind: "consultation",
        memberId: otherMemberId,
        startsAt: new Date("2030-01-08T07:00:00Z"),
        endsAt: new Date("2030-01-08T08:00:00Z"),
      })
      .returning({ id: Booking.id });
    expect(
      await code(
        call(
          noteRouter.create,
          {
            practiceId,
            memberId,
            bookingId: foreignBooking?.id,
            body: "Не та запись",
          },
          { context: api.context(owner) },
        ),
      ),
    ).toBe("NOT_FOUND");

    const note = await call(
      noteRouter.create,
      { practiceId, memberId, body: "Своя" },
      { context: api.context(owner) },
    );
    expect(
      await code(
        call(
          noteRouter.remove,
          { practiceId: otherPracticeId, noteId: note.id },
          { context: api.context(owner) },
        ),
      ),
    ).toBe("FORBIDDEN");
  });

  it("rejects an empty note", async () => {
    await expect(
      call(
        noteRouter.create,
        { practiceId, memberId, body: "   " },
        { context: api.context(owner) },
      ),
    ).rejects.toThrow();
  });
});

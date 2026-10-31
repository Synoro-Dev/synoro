import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq, PracticeMember, Subscription } from "@synoro/db";
import type { BookingQuestion } from "@synoro/validators";

import { createSession, setupTestApi } from "../../../test/helpers";
import { availabilityRouter } from "../availability";
import { bookingRouter } from "../booking";
import { practiceRouter } from "../practice";
import { questionRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;

/** Mondays, 10:00–13:00 MSK: 07:00Z, 08:00Z and 09:00Z are bookable. */
const monday = (week: number, utc = "07:00") =>
  new Date(Date.parse(`2030-01-07T${utc}:00Z`) + week * 7 * 86_400_000);

const REQUEST: BookingQuestion = {
  id: "0b8f7c1e-9a52-4f0e-8a1d-2f6b3c4d5e01",
  label: "С чем хотите прийти?",
  kind: "long_text",
  options: [],
  required: true,
};
const FORMAT: BookingQuestion = {
  id: "0b8f7c1e-9a52-4f0e-8a1d-2f6b3c4d5e02",
  label: "Формат встречи",
  kind: "choice",
  options: ["Онлайн", "В кабинете"],
  required: false,
};

async function newPractice(slug: string) {
  const owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "psychologist" },
    { context: api.context(owner) },
  );
  await call(
    availabilityRouter.replace,
    {
      practiceId: practice.id,
      rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }],
    },
    { context: api.context(owner) },
  );
  return { owner, practiceId: practice.id };
}

async function endPro(owner: Session) {
  await api.db
    .update(Subscription)
    .set({ trialEndsAt: new Date("2020-01-01T00:00:00Z"), paidUntil: null })
    .where(eq(Subscription.userId, owner.user.id));
}

async function newClient(practiceId: string, credits: number) {
  const session = await createSession(api.db, { name: "Иван" });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  await api.db
    .update(PracticeMember)
    .set({ credits })
    .where(eq(PracticeMember.id, member.id));
  return { session, memberId: member.id };
}

const save = (
  owner: Session,
  practiceId: string,
  questions: BookingQuestion[],
) =>
  call(
    questionRouter.save,
    { practiceId, questions },
    { context: api.context(owner) },
  );

const answersOf = async (id: string) =>
  (
    await api.db.query.Booking.findFirst({
      where: eq(Booking.id, id),
      columns: { answers: true },
    })
  )?.answers;

beforeAll(async () => {
  api = await setupTestApi();
});
afterAll(async () => {
  if (api) await api.close();
});

describe("booking questionnaire", () => {
  it("lets the owner save it and shows it on the booking page", async () => {
    const { owner, practiceId } = await newPractice("q-save");
    await save(owner, practiceId, [REQUEST, FORMAT]);

    const listed = await call(
      questionRouter.list,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(listed).toEqual({ pro: true, questions: [REQUEST, FORMAT] });

    const page = await call(
      practiceRouter.bySlug,
      { slug: "q-save" },
      { context: api.context() },
    );
    expect(page.questions).toEqual([REQUEST, FORMAT]);
  });

  it("keeps it from administrators and clients", async () => {
    const { practiceId } = await newPractice("q-owner");
    const { session } = await newClient(practiceId, 0);

    const error = await save(session, practiceId, [REQUEST]).catch((e) => e);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a choice question without two distinct options", async () => {
    const { owner, practiceId } = await newPractice("q-invalid");

    const error = await save(owner, practiceId, [
      { ...FORMAT, options: ["Онлайн", "Онлайн"] },
    ]).catch((e) => e);
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is «Про» only, but can be cleared and stops being asked without it", async () => {
    const { owner, practiceId } = await newPractice("q-free");
    await save(owner, practiceId, [REQUEST]);
    await endPro(owner);

    const error = await save(owner, practiceId, [REQUEST]).catch((e) => e);
    expect(isDefinedError(error) && error.code).toBe("PLAN_REQUIRED");

    const page = await call(
      practiceRouter.bySlug,
      { slug: "q-free" },
      { context: api.context() },
    );
    expect(page.questions).toEqual([]);

    // Not asked, so a booking without answers goes through.
    const { session } = await newClient(practiceId, 1);
    const booking = await call(
      bookingRouter.book,
      { practiceId, startsAt: monday(0) },
      { context: api.context(session) },
    );
    expect(await answersOf(booking.id)).toBeNull();

    await save(owner, practiceId, []);
    const listed = await call(
      questionRouter.list,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(listed).toEqual({ pro: false, questions: [] });
  });
});

describe("answers when booking", () => {
  it("requires the required ones, keeps the wording, and shows them to staff", async () => {
    const { owner, practiceId } = await newPractice("q-book");
    await save(owner, practiceId, [REQUEST, FORMAT]);
    const { session } = await newClient(practiceId, 2);
    const context = { context: api.context(session) };

    const missing = await call(
      bookingRouter.book,
      { practiceId, startsAt: monday(0), answers: { [FORMAT.id]: "Онлайн" } },
      context,
    ).catch((e) => e);
    expect(isDefinedError(missing) && missing.code).toBe("ANSWERS_INVALID");
    expect(missing.data).toEqual({
      errors: { [REQUEST.id]: "Ответьте на вопрос" },
    });

    const offList = await call(
      bookingRouter.book,
      {
        practiceId,
        startsAt: monday(0),
        answers: { [REQUEST.id]: "Тревога", [FORMAT.id]: "По телефону" },
      },
      context,
    ).catch((e) => e);
    expect(offList.data).toEqual({
      errors: { [FORMAT.id]: "Выберите вариант из списка" },
    });

    // Nothing was spent on the rejected attempts.
    const booking = await call(
      bookingRouter.book,
      {
        practiceId,
        startsAt: monday(0),
        answers: { [REQUEST.id]: "  Тревога перед экзаменами  " },
      },
      context,
    );
    expect(booking.credits).toBe(1);

    // Rewording the question later doesn't change what was answered.
    await save(owner, practiceId, [{ ...REQUEST, label: "Ваш запрос" }]);
    const expected = [
      { question: "С чем хотите прийти?", answer: "Тревога перед экзаменами" },
    ];
    expect(await answersOf(booking.id)).toEqual(expected);

    const calendar = await call(
      bookingRouter.calendar,
      { practiceId, from: "2030-01-07", days: 1 },
      { context: api.context(owner) },
    );
    expect(calendar.find((b) => b.id === booking.id)?.answers).toEqual(
      expected,
    );
  });

  it("lets staff book a client without the questionnaire", async () => {
    const { owner, practiceId } = await newPractice("q-staff");
    await save(owner, practiceId, [REQUEST]);
    const { memberId } = await newClient(practiceId, 1);

    const booking = await call(
      bookingRouter.book,
      { practiceId, startsAt: monday(0), memberId },
      { context: api.context(owner) },
    );
    expect(await answersOf(booking.id)).toBeNull();
  });

  it("puts the answers on every booking of a series", async () => {
    const { owner, practiceId } = await newPractice("q-series");
    await save(owner, practiceId, [REQUEST]);
    const { session } = await newClient(practiceId, 3);
    const context = { context: api.context(session) };
    const series = {
      practiceId,
      startsAt: monday(0, "08:00"),
      intervalWeeks: 1 as const,
      count: 3,
    };

    const error = await call(bookingRouter.bookSeries, series, context).catch(
      (e) => e,
    );
    expect(isDefinedError(error) && error.code).toBe("ANSWERS_INVALID");

    const { seriesId } = await call(
      bookingRouter.bookSeries,
      { ...series, answers: { [REQUEST.id]: "Отношения" } },
      context,
    );
    const rows = await api.db.query.Booking.findMany({
      where: eq(Booking.seriesId, seriesId),
      columns: { answers: true },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.answers).toEqual([
        { question: REQUEST.label, answer: "Отношения" },
      ]);
    }
  });
});

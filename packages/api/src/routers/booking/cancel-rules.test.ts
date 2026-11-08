import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq, PracticeMember } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let practiceId: string;

const HOUR = 60 * 60 * 1000;

async function newClient(credits = 1) {
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

/** A paid booking `hours` from now, its credit already taken. */
async function bookingIn(memberId: string, hours: number) {
  const startsAt = new Date(Date.now() + hours * HOUR);
  const [booking] = await api.db
    .insert(Booking)
    .values({
      practiceId,
      kind: "consultation",
      credits: 1,
      memberId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
    })
    .returning();
  await api.db
    .update(PracticeMember)
    .set({ credits: 0 })
    .where(eq(PracticeMember.id, memberId));
  return booking?.id ?? "";
}

const rules = (cancelHours: number, lateCancel: boolean) =>
  call(
    practiceRouter.setCancelRules,
    { practiceId, cancelHours, lateCancel },
    { context: api.context(owner) },
  );

async function balance(memberId: string) {
  const member = await api.db.query.PracticeMember.findFirst({
    where: eq(PracticeMember.id, memberId),
  });
  return member?.credits;
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-rules", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
});

afterAll(async () => {
  await api.close();
});

describe("practice cancel rules", () => {
  it("starts from the profession and only the owner changes them", async () => {
    const tutor = await call(
      practiceRouter.create,
      { name: "Пётр", slug: "petr-tutor", profession: "tutor" },
      { context: api.context(await createSession(api.db)) },
    );
    expect(tutor.cancelHours).toBe(12);

    const { session } = await newClient();
    await expect(
      call(
        practiceRouter.setCancelRules,
        { practiceId, cancelHours: 3, lateCancel: true },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rules(5, false)).rejects.toThrow();
  });

  it("refunds up to the practice's deadline, then refuses naming it", async () => {
    await rules(12, false);
    const { session, memberId } = await newClient();

    const late = await bookingIn(memberId, 11);
    const error = await call(
      bookingRouter.cancel,
      { bookingId: late },
      { context: api.context(session) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "TOO_LATE" });
    expect(error.message).toContain("за 12 часов");

    const early = await bookingIn(memberId, 13);
    const result = await call(
      bookingRouter.cancel,
      { bookingId: early },
      { context: api.context(session) },
    );
    expect(result.refunded).toBe(true);
    expect(await balance(memberId)).toBe(1);
  });

  it("lets a client cancel late without the credit, once they agree", async () => {
    await rules(24, true);
    const { session, memberId } = await newClient();
    const bookingId = await bookingIn(memberId, 5);

    const [mine] = (
      await call(bookingRouter.mine, undefined, {
        context: api.context(session),
      })
    ).filter((b) => b.id === bookingId);
    expect(mine).toMatchObject({
      canCancel: true,
      lateCancel: true,
      canMove: false,
      cancelHours: 24,
    });

    // Without the client's agreement nothing is lost.
    await expect(
      call(
        bookingRouter.cancel,
        { bookingId },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "TOO_LATE" });

    const result = await call(
      bookingRouter.cancel,
      { bookingId, forfeit: true },
      { context: api.context(session) },
    );
    expect(result.refunded).toBe(false);
    expect(await balance(memberId)).toBe(0);
    const row = await api.db.query.Booking.findFirst({
      where: eq(Booking.id, bookingId),
    });
    expect(row?.cancelReason).toBe("late_cancel");
  });

  it("never moves a late booking, even where late cancelling is allowed", async () => {
    await rules(24, true);
    const { session, memberId } = await newClient();
    const bookingId = await bookingIn(memberId, 5);
    const error = await call(
      bookingRouter.rescheduleSlots,
      { bookingId, from: new Date().toISOString().slice(0, 10) },
      { context: api.context(session) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "TOO_LATE" });
    expect(error.message).toContain("Перенести");
  });
});

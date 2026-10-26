import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Session } from "@acme/auth";
import { Booking } from "@acme/db";
import { call, isDefinedError } from "@orpc/server";

import { createSession, setupTestApi } from "../../../test/helpers";
import { errorStatusMap } from "../../errors";
import { availabilityRouter } from "../availability";
import { creditRouter } from "../credit";
import { practiceRouter } from "../practice";
import { bookingRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;

// 2030-01-07 is a Monday; Moscow is UTC+3, so 10:00 MSK = 07:00Z.
const MONDAY = "2030-01-07";
const at = (utc: string) => new Date(`${MONDAY}T${utc}:00Z`);

let owner: Session;
let practiceId: string;

async function newClient(credits = 0) {
  const session = await createSession(api.db);
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  if (credits) {
    await call(
      creditRouter.grant,
      { practiceId, memberId: member.id, delta: credits },
      { context: api.context(owner) },
    );
  }
  return { session, memberId: member.id };
}

function bookAt(session: Session, startsAt: Date) {
  return call(
    bookingRouter.book,
    { practiceId, startsAt },
    { context: api.context(session) },
  );
}

async function balance(session: Session) {
  const practice = await call(
    practiceRouter.get,
    { practiceId },
    { context: api.context(session) },
  );
  return practice.membership.credits;
}

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна, психолог", slug: "anna" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;

  // Monday 10:00–13:00 MSK.
  await call(
    availabilityRouter.replace,
    { practiceId, rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }] },
    { context: api.context(owner) },
  );
});
afterAll(() => api.close());

describe("practice", () => {
  it("rejects a taken slug with a typed CONFLICT", async () => {
    const error = await call(
      practiceRouter.create,
      { name: "Другая", slug: "anna" },
      { context: api.context(owner) },
    ).catch((e) => e);

    expect(error).toMatchObject({ code: "CONFLICT", data: { field: "slug" } });
    expect(isDefinedError(error)).toBe(true);
  });

  it("shows the public page with the caller's membership", async () => {
    const anonymous = await call(
      practiceRouter.bySlug,
      { slug: "ANNA" },
      { context: api.context() },
    );
    expect(anonymous.membership).toBeNull();

    const mine = await call(
      practiceRouter.bySlug,
      { slug: "anna" },
      { context: api.context(owner) },
    );
    expect(mine.membership?.role).toBe("owner");
  });

  it("lets only the owner appoint administrators", async () => {
    const admin = await createSession(api.db, { email: "admin@anna.test" });
    const added = await call(
      practiceRouter.addMember,
      { practiceId, email: "ADMIN@anna.test", role: "admin" },
      { context: api.context(owner) },
    );
    expect(added.role).toBe("admin");

    await createSession(api.db, { email: "other@anna.test" });
    const promise = call(
      practiceRouter.addMember,
      { practiceId, email: "other@anna.test", role: "admin" },
      { context: api.context(admin) },
    );
    await expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });

    const client = await call(
      practiceRouter.addMember,
      { practiceId, email: "other@anna.test", role: "client" },
      { context: api.context(admin) },
    );
    expect(client.role).toBe("client");
  });
});

describe("booking.book", () => {
  it("refuses to book without paid consultations", async () => {
    const { session } = await newClient();
    const error = await bookAt(session, at("07:00")).catch((e) => e);

    expect(error).toMatchObject({ code: "NO_CREDITS" });
    expect(errorStatusMap[error.code]).toBe(402);
    expect(isDefinedError(error)).toBe(true);
  });

  it("spends one credit per booked hour and stops at zero", async () => {
    const { session } = await newClient(2);

    const first = await bookAt(session, at("07:00"));
    expect(first.credits).toBe(1);
    expect(first.endsAt.toISOString()).toBe(`${MONDAY}T08:00:00.000Z`);

    const second = await bookAt(session, at("08:00"));
    expect(second.credits).toBe(0);

    await expect(bookAt(session, at("09:00"))).rejects.toMatchObject({
      code: "NO_CREDITS",
    });

    const { slots } = await call(
      bookingRouter.slots,
      { practiceId, from: MONDAY, days: 1 },
      { context: api.context() },
    );
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      `${MONDAY}T09:00:00.000Z`,
    ]);

    // Clean up for the following tests.
    for (const b of [first, second]) {
      await call(
        bookingRouter.cancel,
        { bookingId: b.id },
        { context: api.context(session) },
      );
    }
  });

  it("gives a slot to one client only and returns the loser's credit", async () => {
    const a = await newClient(1);
    const b = await newClient(1);

    const results = await Promise.allSettled([
      bookAt(a.session, at("09:00")),
      bookAt(b.session, at("09:00")),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost[0]?.reason).toMatchObject({ code: "SLOT_UNAVAILABLE" });

    const balances = [await balance(a.session), await balance(b.session)];
    expect(balances.sort()).toEqual([0, 1]);

    const booking = won[0]?.value;
    if (booking) {
      await call(
        bookingRouter.cancel,
        { bookingId: booking.id },
        { context: api.context(owner) },
      );
    }
  });

  it("only accepts whole hours inside working hours", async () => {
    const { session } = await newClient(1);

    for (const time of ["07:30", "10:00", "06:00"]) {
      await expect(bookAt(session, at(time))).rejects.toMatchObject({
        code: "SLOT_UNAVAILABLE",
      });
    }
    // Tuesday has no working hours.
    await expect(
      bookAt(session, new Date("2030-01-08T07:00:00Z")),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    expect(await balance(session)).toBe(1);
  });

  it("is forbidden outside the practice", async () => {
    const stranger = await createSession(api.db);
    await expect(bookAt(stranger, at("07:00"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("booking.cancel", () => {
  it("refunds a client who cancels at least 24 h ahead", async () => {
    const { session } = await newClient(1);
    const booking = await bookAt(session, at("07:00"));
    expect(await balance(session)).toBe(0);

    const result = await call(
      bookingRouter.cancel,
      { bookingId: booking.id },
      { context: api.context(session) },
    );
    expect(result.refunded).toBe(true);
    expect(await balance(session)).toBe(1);

    await expect(
      call(
        bookingRouter.cancel,
        { bookingId: booking.id },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stops a client within 24 h, but staff can still cancel", async () => {
    const { session, memberId } = await newClient();
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const [booking] = await api.db
      .insert(Booking)
      .values({
        practiceId,
        kind: "consultation",
        memberId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      })
      .returning();
    const bookingId = booking?.id ?? "";

    const error = await call(
      bookingRouter.cancel,
      { bookingId },
      { context: api.context(session) },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "TOO_LATE" });
    expect(isDefinedError(error)).toBe(true);

    const result = await call(
      bookingRouter.cancel,
      { bookingId, refund: false },
      { context: api.context(owner) },
    );
    expect(result.refunded).toBe(false);
    expect(await balance(session)).toBe(0);
  });

  it("hides other clients' bookings", async () => {
    const a = await newClient(1);
    const b = await newClient();
    const booking = await bookAt(a.session, at("07:00"));

    await expect(
      call(
        bookingRouter.cancel,
        { bookingId: booking.id },
        { context: api.context(b.session) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call(
      bookingRouter.cancel,
      { bookingId: booking.id },
      { context: api.context(owner) },
    );
  });
});

describe("staff bookings", () => {
  it("books free half-hour consultations for guests", async () => {
    const free = await call(
      bookingRouter.bookFree,
      { practiceId, startsAt: at("07:30"), guestName: "Иван" },
      { context: api.context(owner) },
    );
    expect(free.endsAt.toISOString()).toBe(`${MONDAY}T08:00:00.000Z`);

    // The paid 10:00 hour now overlaps the free 10:30 half hour.
    const { slots } = await call(
      bookingRouter.slots,
      { practiceId, from: MONDAY, days: 1 },
      { context: api.context() },
    );
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      `${MONDAY}T08:00:00.000Z`,
      `${MONDAY}T09:00:00.000Z`,
    ]);

    const { session } = await newClient(1);
    await expect(bookAt(session, at("07:00"))).rejects.toMatchObject({
      code: "SLOT_UNAVAILABLE",
    });

    await expect(
      call(
        bookingRouter.bookFree,
        { practiceId, startsAt: at("07:30"), guestName: "Пётр" },
        { context: api.context(owner) },
      ),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });

    await expect(
      call(
        bookingRouter.bookFree,
        { practiceId, startsAt: at("07:00"), guestName: "Пётр" },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await call(
      bookingRouter.cancel,
      { bookingId: free.id },
      { context: api.context(owner) },
    );
  });

  it("blocks time so clients can't book it", async () => {
    const block = await call(
      bookingRouter.block,
      { practiceId, startsAt: at("08:00"), endsAt: at("10:00"), note: "Своё" },
      { context: api.context(owner) },
    );

    const { session } = await newClient(1);
    await expect(bookAt(session, at("08:00"))).rejects.toMatchObject({
      code: "SLOT_UNAVAILABLE",
    });
    expect(await balance(session)).toBe(1);

    const calendar = await call(
      bookingRouter.calendar,
      { practiceId, from: MONDAY, days: 1 },
      { context: api.context(owner) },
    );
    expect(calendar.map((b) => b.kind)).toEqual(["blocked"]);

    await expect(
      call(
        bookingRouter.block,
        { practiceId, startsAt: at("09:00"), endsAt: at("09:30") },
        { context: api.context(owner) },
      ),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });

    await expect(
      call(
        bookingRouter.block,
        { practiceId, startsAt: at("07:15"), endsAt: at("07:45") },
        { context: api.context(owner) },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await call(
      bookingRouter.cancel,
      { bookingId: block.id },
      { context: api.context(owner) },
    );
  });
});

describe("credit.grant", () => {
  it("keeps balances non-negative and writes history", async () => {
    const { session, memberId } = await newClient(3);

    await expect(
      call(
        creditRouter.grant,
        { practiceId, memberId, delta: -5 },
        { context: api.context(owner) },
      ),
    ).rejects.toMatchObject({ code: "NEGATIVE_BALANCE" });

    const result = await call(
      creditRouter.grant,
      { practiceId, memberId, delta: -1, note: "Ошибка" },
      { context: api.context(owner) },
    );
    expect(result.credits).toBe(2);

    const history = await call(
      creditRouter.history,
      { memberId },
      { context: api.context(session) },
    );
    expect(history.map((h) => [h.delta, h.reason]).sort()).toEqual([
      [-1, "adjustment"],
      [3, "purchase"],
    ]);
  });

  it("is staff-only and scoped to the practice", async () => {
    const { session, memberId } = await newClient();
    await expect(
      call(
        creditRouter.grant,
        { practiceId, memberId, delta: 10 },
        { context: api.context(session) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The owner of another practice can't touch this practice's clients.
    const otherOwner = await createSession(api.db);
    const other = await call(
      practiceRouter.create,
      { name: "Другая практика", slug: "other" },
      { context: api.context(otherOwner) },
    );
    await expect(
      call(
        creditRouter.grant,
        { practiceId: other.id, memberId, delta: 10 },
        { context: api.context(otherOwner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        bookingRouter.calendar,
        { practiceId, from: MONDAY },
        { context: api.context(otherOwner) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(
        creditRouter.history,
        { memberId },
        { context: api.context(otherOwner) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

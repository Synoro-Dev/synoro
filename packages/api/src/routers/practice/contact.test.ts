import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { Booking, eq, PracticeMember } from "@synoro/db";

import { createSession, setupTestApi } from "../../../test/helpers";
import { hashGuestToken } from "../../lib/guests";
import { bookingRouter } from "../booking";
import { practiceRouter } from ".";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CONTACT = "@anna, +7 900 123-45-67";
const TOKEN = "contact-test-token-0001";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let owner: Session;
let admin: Session;
let client: Session;
let practiceId: string;
let memberId: string;

/** A booking of the client in three days, reachable by `TOKEN`. */
async function insertBooking(
  values: Partial<typeof Booking.$inferInsert> = {},
) {
  const startsAt = new Date(Date.now() + 3 * DAY);
  await api.db.delete(Booking).where(eq(Booking.practiceId, practiceId));
  await api.db.insert(Booking).values({
    practiceId,
    kind: "consultation",
    startsAt,
    endsAt: new Date(startsAt.getTime() + HOUR),
    memberId,
    accessTokenHash: hashGuestToken(TOKEN),
    ...values,
  });
}

const mine = () =>
  call(bookingRouter.mine, undefined, { context: api.context(client) });
const guest = () =>
  call(bookingRouter.guest, { token: TOKEN }, { context: api.context() });

beforeAll(async () => {
  api = await setupTestApi();
  owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug: "anna-contact", profession: "psychologist" },
    { context: api.context(owner) },
  );
  practiceId = practice.id;
  admin = await createSession(api.db, { name: "Ольга" });
  await api.db
    .insert(PracticeMember)
    .values({ practiceId, userId: admin.user.id, role: "admin" });
  client = await createSession(api.db, { name: "Иван" });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(client) },
  );
  memberId = member.id;
  await call(
    practiceRouter.setContact,
    { practiceId, contact: `  ${CONTACT} ` },
    { context: api.context(owner) },
  );
});
afterAll(async () => {
  if (api) await api.close();
});

describe("practice.setContact", () => {
  it("saves it for the owner, trimmed", async () => {
    const practice = await call(
      practiceRouter.get,
      { practiceId },
      { context: api.context(owner) },
    );
    expect(practice.clientContact).toBe(CONTACT);
  });

  it("is the owner's to set", async () => {
    for (const session of [admin, client]) {
      await expect(
        call(
          practiceRouter.setContact,
          { practiceId, contact: "@someone" },
          { context: api.context(session) },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("clears it with an empty string", async () => {
    const other = await createSession(api.db, { name: "Мария" });
    const { id } = await call(
      practiceRouter.create,
      { name: "Мария", slug: "maria-contact", profession: "tutor" },
      { context: api.context(other) },
    );
    await call(
      practiceRouter.setContact,
      { practiceId: id, contact: "@maria" },
      { context: api.context(other) },
    );
    const cleared = await call(
      practiceRouter.setContact,
      { practiceId: id, contact: " " },
      { context: api.context(other) },
    );
    expect(cleared.contact).toBeNull();
  });
});

describe("who sees the contact", () => {
  it("a client on a confirmed booking", async () => {
    await insertBooking();
    expect((await mine())[0]?.contact).toBe(CONTACT);
    expect((await guest()).contact).toBe(CONTACT);
  });

  it("nobody while the booking is unpaid", async () => {
    await insertBooking({ holdUntil: new Date(Date.now() + HOUR) });
    expect((await mine())[0]?.contact).toBeNull();
    expect((await guest()).contact).toBeNull();
  });

  it("nobody once it is cancelled", async () => {
    await insertBooking({
      status: "cancelled",
      cancelReason: "client",
      cancelledAt: new Date(),
    });
    expect((await mine())[0]?.contact).toBeNull();
    expect((await guest()).contact).toBeNull();
  });

  it("not a client without a booking: joining is open to anyone", async () => {
    const practice = await call(
      practiceRouter.get,
      { practiceId },
      { context: api.context(client) },
    );
    expect(practice.clientContact).toBeNull();
  });

  it("not the public procedures", async () => {
    const page = await call(
      practiceRouter.bySlug,
      { slug: "anna-contact" },
      { context: api.context(client) },
    );
    const free = await call(
      bookingRouter.slots,
      { practiceId, from: "2030-01-07", days: 1 },
      { context: api.context() },
    );
    expect(JSON.stringify([page, free])).not.toContain("@anna");
  });
});

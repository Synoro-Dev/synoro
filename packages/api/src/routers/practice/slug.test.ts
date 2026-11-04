import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  spyOn,
} from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { eq, Practice, SlugOrder } from "@synoro/db";
import { PREMIUM_SLUG_PRICE } from "@synoro/validators";

import { createSession, setupTestApi } from "../../../test/helpers";
import { handleBillingWebhook } from "../../lib/billing";
import { moveToSlug } from "../../lib/practice-slugs";
import { practiceRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let fetchMock: Mock<typeof fetch>;
/** Точка's answers by operation: `status` and `amount` (rubles). */
const operations = new Map<string, { status: string; amount: number }>();
let bankRefuses = false;
let sessions = 0;

async function owner(slug = `practice-${++sessions}`) {
  const session = await createSession(api.db, {
    email: `owner-${++sessions}@test.local`,
  });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "tutor" },
    { context: api.context(session) },
  );
  return { session, practice };
}

function setSlug(session: Session, practiceId: string, slug: string) {
  return call(
    practiceRouter.setSlug,
    { practiceId, slug },
    { context: api.context(session) },
  );
}

async function slugOf(practiceId: string) {
  const practice = await api.db.query.Practice.findFirst({
    where: eq(Practice.id, practiceId),
  });
  return practice?.slug;
}

async function operationOf(orderId: string) {
  const order = await api.db.query.SlugOrder.findFirst({
    where: eq(SlugOrder.id, orderId),
  });
  if (!order?.externalId) throw new Error("No operation id");
  return order.externalId;
}

function bySlug(slug: string) {
  return call(practiceRouter.bySlug, { slug }, { context: api.context() });
}

function webhook(operationId: string) {
  const claims = Buffer.from(
    JSON.stringify({ webhookType: "acquiringInternetPayment", operationId }),
  ).toString("base64url");
  return handleBillingWebhook(
    new Request("http://localhost/api/billing/tochka", {
      method: "POST",
      body: `h.${claims}.s`,
    }),
    api.db,
  );
}

beforeAll(async () => {
  api = await setupTestApi();
  fetchMock = spyOn(globalThis, "fetch");
});
beforeEach(() => {
  bankRefuses = false;
  fetchMock.mockImplementation((async (input, init = {}) => {
    if (bankRefuses) return Response.json({ message: "no" }, { status: 400 });
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const operationId = `slug-op-${operations.size + 1}`;
      operations.set(operationId, {
        status: "CREATED",
        amount: body.Data.amount,
      });
      return Response.json({
        Data: {
          ...body.Data,
          operationId,
          status: "CREATED",
          paymentLink: `https://merch.tochka.com/order/?uuid=${operationId}`,
        },
      });
    }
    const operationId = decodeURIComponent(
      String(input).split("/").pop() ?? "",
    );
    return Response.json({
      Data: {
        Operation: [
          {
            operationId,
            ...operations.get(operationId),
            paymentLink: "https://merch.tochka.com/order/",
          },
        ],
      },
    });
  }) as typeof fetch);
});
afterEach(() => {
  fetchMock.mockReset();
});
afterAll(async () => {
  fetchMock.mockRestore();
  await api.close();
});

describe("creating a practice with a premium address", () => {
  it("opens it on a temporary address and moves it once paid", async () => {
    const { session, practice } = await owner("max");
    expect(practice.slug).toStartWith("max-");
    if (!practice.slugOrder) throw new Error("No order");
    expect(practice.slugOrder.confirmationUrl).toContain("merch.tochka.com");

    const operationId = await operationOf(practice.slugOrder.orderId);
    expect(operations.get(operationId)?.amount).toBe(PREMIUM_SLUG_PRICE / 100);
    expect(await slugOf(practice.id)).toBe(practice.slug);

    operations.set(operationId, {
      status: "APPROVED",
      amount: PREMIUM_SLUG_PRICE / 100,
    });
    const order = await call(
      practiceRouter.slugOrder,
      { orderId: practice.slugOrder.orderId },
      { context: api.context(session) },
    );
    expect(order.status).toBe("succeeded");
    expect(await slugOf(practice.id)).toBe("max");
  });

  it("keeps the practice when the bank refuses, and drops the order", async () => {
    bankRefuses = true;
    const { practice } = await owner("nobk");
    expect(practice.slugOrder).toBeNull();
    expect(practice.slug).toStartWith("nobk-");
    const orders = await api.db.query.SlugOrder.findMany({
      where: eq(SlugOrder.practiceId, practice.id),
    });
    expect(orders).toEqual([]);
  });

  it("creates a longer address for free, with no bank involved", async () => {
    const { practice } = await owner("maxim");
    expect(practice.slug).toBe("maxim");
    expect(practice.slugOrder).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("practice.setSlug", () => {
  it("changes a free address at once; the old one leads to the page", async () => {
    const { session, practice } = await owner();
    const result = await setSlug(session, practice.id, "new-address");
    expect(result.status).toBe("changed");
    expect(await slugOf(practice.id)).toBe("new-address");

    const found = await bySlug(practice.slug);
    expect(found.id).toBe(practice.id);
    expect(found.slug).toBe("new-address");
  });

  it("charges for a premium address and changes it only when paid", async () => {
    const { session, practice } = await owner();
    const result = await setSlug(session, practice.id, "ivan");
    if (result.status !== "payment") throw new Error("Expected a payment");
    expect(await slugOf(practice.id)).toBe(practice.slug);
    await expect(bySlug("ivan")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const operationId = await operationOf(result.orderId);
    operations.set(operationId, {
      status: "APPROVED",
      amount: PREMIUM_SLUG_PRICE / 100,
    });
    expect((await webhook(operationId)).status).toBe(200);
    expect(await slugOf(practice.id)).toBe("ivan");
  });

  it("settles a paid order once: a repeated webhook changes nothing", async () => {
    const { session, practice } = await owner();
    const result = await setSlug(session, practice.id, "once");
    if (result.status !== "payment") throw new Error("Expected a payment");
    const operationId = await operationOf(result.orderId);
    operations.set(operationId, {
      status: "APPROVED",
      amount: PREMIUM_SLUG_PRICE / 100,
    });
    await webhook(operationId);
    await setSlug(session, practice.id, "once-more");
    await webhook(operationId);
    expect(await slugOf(practice.id)).toBe("once-more");
  });

  it("does not give the address for a different amount", async () => {
    const { session, practice } = await owner();
    const result = await setSlug(session, practice.id, "chep");
    if (result.status !== "payment") throw new Error("Expected a payment");
    const operationId = await operationOf(result.orderId);
    operations.set(operationId, { status: "APPROVED", amount: 1 });
    await webhook(operationId);
    expect(await slugOf(practice.id)).toBe(practice.slug);
  });

  it("holds the name for the buyer while they pay", async () => {
    const buyer = await owner();
    const other = await owner();
    const first = await setSlug(buyer.session, buyer.practice.id, "hold");
    if (first.status !== "payment") throw new Error("Expected a payment");

    const error = await setSlug(other.session, other.practice.id, "hold").catch(
      (e) => e,
    );
    expect(error).toMatchObject({ code: "CONFLICT", data: { field: "slug" } });
    expect(isDefinedError(error)).toBe(true);

    // The buyer asking again gets the same link, not a second order.
    const again = await setSlug(buyer.session, buyer.practice.id, "hold");
    expect(again).toMatchObject({ orderId: first.orderId });
  });

  it("releases the name only when the bank says the link ran out", async () => {
    const buyer = await owner();
    const other = await owner();
    const first = await setSlug(buyer.session, buyer.practice.id, "laps");
    if (first.status !== "payment") throw new Error("Expected a payment");
    await api.db
      .update(SlugOrder)
      .set({ holdUntil: new Date(Date.now() - 1000) })
      .where(eq(SlugOrder.id, first.orderId));

    // Past the hold, but the link may still be paid.
    await expect(
      setSlug(other.session, other.practice.id, "laps"),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const operationId = await operationOf(first.orderId);
    operations.set(operationId, {
      status: "EXPIRED",
      amount: PREMIUM_SLUG_PRICE / 100,
    });
    const second = await setSlug(other.session, other.practice.id, "laps");
    expect(second.status).toBe("payment");
  });

  it("gives a late payment past the hold to the one who paid", async () => {
    const buyer = await owner();
    const other = await owner();
    const first = await setSlug(buyer.session, buyer.practice.id, "late");
    if (first.status !== "payment") throw new Error("Expected a payment");
    await api.db
      .update(SlugOrder)
      .set({ holdUntil: new Date(Date.now() - 1000) })
      .where(eq(SlugOrder.id, first.orderId));
    operations.set(await operationOf(first.orderId), {
      status: "APPROVED",
      amount: PREMIUM_SLUG_PRICE / 100,
    });

    await expect(
      setSlug(other.session, other.practice.id, "late"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await slugOf(buyer.practice.id)).toBe("late");
  });

  it("caps how many names one user can hold unpaid", async () => {
    const { session, practice } = await owner();
    for (const slug of ["cap1", "cap2", "cap3"]) {
      await setSlug(session, practice.id, slug);
    }
    await expect(setSlug(session, practice.id, "cap4")).rejects.toMatchObject({
      code: "TOO_MANY_ORDERS",
    });
  });

  it("keeps the cap when one user orders names in parallel", async () => {
    const { session, practice } = await owner();
    const results = await Promise.allSettled(
      ["par1", "par2", "par3", "par4", "par5", "par6"].map((slug) =>
        setSlug(session, practice.id, slug),
      ),
    );
    const held = await api.db.query.SlugOrder.findMany({
      where: eq(SlugOrder.userId, session.user.id),
    });
    expect(held).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
  });

  it("won't move a practice onto an address another one holds", async () => {
    const first = await owner("held-now");
    const second = await owner();
    await setSlug(first.session, first.practice.id, "held-later");

    // What a request that checked before the name was taken would do next.
    for (const slug of ["held-now", "held-later"]) {
      expect(await moveToSlug(api.db, second.practice.id, slug)).toBe(false);
    }
    expect(await slugOf(second.practice.id)).toBe(second.practice.slug);
  });

  it("creates one practice when two ask for a free address at once", async () => {
    const [a, b] = await Promise.all([
      createSession(api.db, { email: "race-a@test.local" }),
      createSession(api.db, { email: "race-b@test.local" }),
    ]);
    const results = await Promise.allSettled(
      [a, b].map((session) =>
        call(
          practiceRouter.create,
          { name: "Гонка", slug: "same-address", profession: "other" },
          { context: api.context(session) },
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected");
    expect(lost).toMatchObject({ reason: { code: "CONFLICT" } });
  });

  it("lists the addresses a practice can return to for free", async () => {
    const { session, practice } = await owner();
    await setSlug(session, practice.id, "listed-address");
    const found = await call(
      practiceRouter.get,
      { practiceId: practice.id },
      { context: api.context(session) },
    );
    expect(found.formerSlugs).toEqual([practice.slug]);
  });

  it("never gives a former address to someone else", async () => {
    const first = await owner("left-behind");
    const second = await owner();
    await setSlug(first.session, first.practice.id, "moved-on");

    await expect(
      setSlug(second.session, second.practice.id, "left-behind"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      call(
        practiceRouter.create,
        { name: "Другая", slug: "left-behind", profession: "other" },
        { context: api.context(second.session) },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets a practice return to its own former address for free", async () => {
    const { session, practice } = await owner();
    const bought = await setSlug(session, practice.id, "back");
    if (bought.status !== "payment") throw new Error("Expected a payment");
    const operationId = await operationOf(bought.orderId);
    operations.set(operationId, {
      status: "APPROVED",
      amount: PREMIUM_SLUG_PRICE / 100,
    });
    await webhook(operationId);
    await setSlug(session, practice.id, "away-for-now");

    const result = await setSlug(session, practice.id, "back");
    expect(result.status).toBe("changed");
    expect(await slugOf(practice.id)).toBe("back");
    expect((await bySlug("away-for-now")).slug).toBe("back");
  });

  it("is the owner's: staff and strangers can't change it", async () => {
    const { practice } = await owner();
    const stranger = await createSession(api.db, {
      email: "stranger@test.local",
    });
    await expect(
      setSlug(stranger, practice.id, "stolen-name"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

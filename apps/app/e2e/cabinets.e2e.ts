import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { appRouter } from "@synoro/api";

/**
 * The redesigned cabinets, end to end. Data is set up through the same
 * oRPC API the app calls (as the signed-in user, with their cookies);
 * what the user does is done through the interface.
 */

// Signing up may wait out the auth rate limit (see `signUp`).
test.describe.configure({ timeout: 90_000 });

const PASSWORD = "e2e-password-123";
const HOUR = 60 * 60 * 1000;

type Api = RouterClient<typeof appRouter>;

function uniqueEmail() {
  return `e2e-${crypto.randomUUID()}@example.com`;
}

async function signUp(page: Page) {
  const email = uniqueEmail();
  await page.goto("/auth/signup");
  await page
    .getByRole("button", { name: "Зарегистрироваться с паролем" })
    .click();
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  // Better Auth allows 3 sign-ups per 10 s from one address: a suite
  // signing up several people waits out the window and submits again.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    try {
      await page.waitForURL("/practices", { timeout: 15_000 });
      break;
    } catch {
      await page.waitForTimeout(11_000);
    }
  }
  await expect(page).toHaveURL("/practices");
  return email;
}

/** The API as the user signed in to `context`. */
async function apiFor(context: BrowserContext, baseURL: string): Promise<Api> {
  const cookie = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return createORPCClient(
    new RPCLink({ origin: baseURL, url: "/api/orpc", headers: { cookie } }),
  );
}

/** A whole hour at least `ms` from now (bookings start on the hour). */
function hourAfter(ms: number) {
  const at = new Date(Date.now() + ms);
  at.setUTCMinutes(0, 0, 0);
  return new Date(at.getTime() + HOUR);
}

async function ownerWithPractice(page: Page, baseURL: string) {
  await signUp(page);
  const api = await apiFor(page.context(), baseURL);
  const practice = await api.practice.create({
    name: "Репетитор по математике",
    slug: `e2e-${crypto.randomUUID().slice(0, 8)}`,
    profession: "tutor",
  });
  return { api, practiceId: practice.id };
}

test("first setup: «Сегодня» shows what is left until done", async ({
  page,
  baseURL,
}) => {
  const { api, practiceId } = await ownerWithPractice(page, baseURL ?? "");

  await page.goto(`/practices/${practiceId}`);
  await expect(page.getByText("Настройка практики")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Задайте рабочие часы/ }),
  ).toBeVisible();

  await api.availability.replace({
    practiceId,
    rules: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startMinute: 600,
      endMinute: 1080,
    })),
  });
  await page.reload();
  await expect(
    page
      .getByRole("link", { name: /Задайте рабочие часы/ })
      .getByLabel("Готово"),
  ).toBeVisible();
});

test.describe("away from the practice's zone", () => {
  test.use({ timezoneId: "Asia/Novosibirsk" });

  test("«Закрыть даты» closes the practice's calendar days", async ({
    page,
    baseURL,
  }) => {
    const { api, practiceId } = await ownerWithPractice(page, baseURL ?? "");
    const day = (offset: number) =>
      new Date(Date.now() + offset * 24 * HOUR).toISOString().slice(0, 10);
    const first = day(10);
    const last = day(11);
    const after = day(12);

    await page.goto(`/practices/${practiceId}/calendar`);
    await page.getByRole("button", { name: "Закрыть даты" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Дни считаются по времени практики"),
    ).toBeVisible();
    await dialog.getByLabel("С", { exact: true }).fill(first);
    await dialog.getByLabel("По", { exact: true }).fill(last);
    await dialog.getByRole("button", { name: "Закрыть даты" }).click();
    await expect(page.getByText("Даты закрыты")).toBeVisible();

    // New practices are on Moscow time (+03:00), the browser on +07:00.
    const entries = await api.booking.calendar({
      practiceId,
      from: first,
      days: 2,
    });
    const closed = entries.find((b) => b.kind === "blocked");
    expect(closed?.startsAt.toISOString()).toBe(
      new Date(`${first}T00:00:00+03:00`).toISOString(),
    );
    expect(closed?.endsAt.toISOString()).toBe(
      new Date(`${after}T00:00:00+03:00`).toISOString(),
    );
  });
});

test("client cancels in time (credit back) but not within 24 hours", async ({
  page,
  browser,
  baseURL,
}) => {
  // Two sign-ups, each of which may wait out the rate limit.
  test.setTimeout(180_000);
  const base = baseURL ?? "";
  const { api: owner, practiceId } = await ownerWithPractice(page, base);
  // Open every hour of every day, so any whole hour can be booked.
  await owner.availability.replace({
    practiceId,
    rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      startMinute: 0,
      endMinute: 1440,
    })),
  });

  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  await signUp(clientPage);
  const client = await apiFor(clientContext, base);
  await client.user.updatePhone({ phone: "+79161234567" });
  await client.practice.join({ practiceId });

  const members = await owner.practice.members({ practiceId });
  const member = members.find((m) => m.role === "client");
  if (!member) throw new Error("the client did not join");
  await owner.credit.grant({ practiceId, memberId: member.id, delta: 3 });
  const late = hourAfter(3 * HOUR);
  const inTime = hourAfter(72 * HOUR);
  await owner.booking.book({ practiceId, memberId: member.id, startsAt: late });
  await owner.booking.book({
    practiceId,
    memberId: member.id,
    startsAt: inTime,
  });

  await clientPage.goto("/bookings");
  await expect(clientPage.getByText("Ближайшая запись")).toBeVisible();
  await expect(clientPage.getByText(/Остал\S+ 1 занятие/)).toBeVisible();

  // The nearest one starts in about three hours: too late to cancel.
  await clientPage
    .getByRole("button", { name: "Отменить", exact: true })
    .first()
    .click();
  await expect(
    clientPage.getByRole("heading", { name: "Отменить уже нельзя" }),
  ).toBeVisible();
  await clientPage.getByRole("button", { name: "Понятно" }).click();

  // The one in three days goes, and its credit comes back.
  await clientPage
    .getByRole("button", { name: "Отменить", exact: true })
    .last()
    .click();
  await expect(
    clientPage.getByRole("heading", { name: "Отменить запись?" }),
  ).toBeVisible();
  await expect(clientPage.getByText(/на нём станет 2 занятия/)).toBeVisible();
  await clientPage.getByRole("button", { name: "Отменить запись" }).click();
  await expect(
    clientPage.getByText("Запись отменена, оплата вернулась на баланс"),
  ).toBeVisible();
  await expect(clientPage.getByText(/Осталось 2 занятия/)).toBeVisible();

  await clientContext.close();
});

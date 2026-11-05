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

test("the first setup opens once, every step can be skipped", async ({
  page,
  baseURL,
}) => {
  await signUp(page);
  const api = await apiFor(page.context(), baseURL ?? "");

  await page.goto("/practices?new=1");
  await page.getByLabel("Название").fill("Репетитор по математике");
  await page.getByRole("combobox", { name: "Чем вы занимаетесь" }).click();
  await page.getByRole("option", { name: /Репетитор/ }).click();
  await page
    .getByLabel("Адрес страницы записи")
    .fill(`e2e-${crypto.randomUUID().slice(0, 8)}`);
  await page.getByRole("button", { name: "Создать" }).click();

  // Right after creating: the working hours, weekdays 09:00–18:00 proposed.
  await page.waitForURL(/\/practices\/[0-9a-f-]{36}\/setup/);
  const practiceId = /practices\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  await expect(page.getByText("Шаг 1 из 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Суббота" }).click();
  await page.getByRole("button", { name: "Сохранить и продолжить" }).click();

  // Prices: nothing to save yet, so skipping and going on are the same.
  await expect(page.getByText("Шаг 2 из 4", { exact: true })).toBeVisible();
  const rules = await api.availability.list({ practiceId });
  expect(rules.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(rules[0]).toMatchObject({ startMinute: 540, endMinute: 1080 });

  // A switch applies at once, and coming back to the step still shows it.
  const freeBooking = page.getByRole("switch", { name: /Принимать запись/ });
  await freeBooking.click();
  await expect(page.getByText(/Клиенты могут записаться/)).toBeVisible();
  await page.getByRole("button", { name: "Пропустить" }).click();
  await expect(page.getByText("Шаг 3 из 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(freeBooking).toBeChecked();
  await page.getByRole("button", { name: "Пропустить" }).click();

  // The rules are only read, with an example.
  await expect(page.getByText("Шаг 3 из 4", { exact: true })).toBeVisible();
  await expect(page.getByText(/Например, запись на среду/)).toBeVisible();
  await page.getByRole("button", { name: "Дальше" }).click();

  // The link, then «Сегодня».
  await expect(page.getByText("Шаг 4 из 4", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Ссылка для записи")).toBeVisible();
  await page.getByRole("button", { name: "Готово" }).click();
  await page.waitForURL(`/practices/${practiceId}`);

  // Not imposed again: «Сегодня» only offers to go on, at the skipped step.
  await page.reload();
  await expect(page).toHaveURL(`/practices/${practiceId}`);
  await expect(
    page
      .getByRole("link", { name: /Задайте рабочие часы/ })
      .getByLabel("Готово"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Продолжить настройку" }).click();
  await expect(page).toHaveURL(/\/setup\?step=/);
  // Hours already set are shown, not proposed again over them.
  await page.goto(`/practices/${practiceId}/setup?step=hours`);
  await expect(
    page.getByText("Рабочие часы уже заданы", { exact: true }),
  ).toBeVisible();
});

test("a saved video link is no longer a draft", async ({ page, baseURL }) => {
  const { practiceId } = await ownerWithPractice(page, baseURL ?? "");

  await page.goto(`/practices/${practiceId}/booking-page`);
  const link = page.getByLabel("Ссылка на видеовстречу");
  await link.fill("https://telemost.yandex.ru/j/123");
  await expect(
    page.getByText("Есть несохранённые изменения", { exact: true }),
  ).toBeVisible();
  await page
    .locator("form")
    .filter({ has: link })
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Есть несохранённые изменения", { exact: true }),
  ).toHaveCount(0);
});

test("the specialist credits a package and books the client", async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? "";
  const { api: owner, practiceId } = await ownerWithPractice(page, base);
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
  await clientContext.close();

  // The form proposes the next half hour, paid bookings start on the hour:
  // at :40 of any hour the proposal is a whole one.
  const clock = new Date();
  clock.setMinutes(40, 0, 0);
  await page.clock.setFixedTime(clock);

  const clients = await owner.practice.members({ practiceId });
  const name = clients.find((m) => m.role === "client")?.name ?? "";

  await page.goto(`/practices/${practiceId}/clients`);
  await page.getByRole("button", { name: `Открыть карточку: ${name}` }).click();
  // By name: the dialogs opened from the card can linger as they close.
  const card = page.getByRole("dialog", { name });
  await expect(card.getByText("0 занятий", { exact: true })).toBeVisible();

  // A package of five, recorded by hand after the client paid.
  await card.getByRole("button", { name: "Начислить" }).click();
  const credit = page.getByRole("dialog", { name: "Начислить" });
  await credit.getByRole("button", { name: "+5" }).click();
  await credit.getByLabel("Комментарий").fill("Оплата пакета из 5");
  await credit.getByRole("button", { name: "Начислить" }).click();
  await expect(page.getByText(/Начислено\. На балансе .*: 5/)).toBeVisible();
  await expect(card.getByText("5 занятий", { exact: true })).toBeVisible();

  // Booked from the card, a whole hour in the coming days.
  await card.getByRole("button", { name: "Записать" }).click();
  const entry = page.getByRole("dialog", { name: "Новая запись" });
  const startsAt = new Date(Date.now() + 72 * HOUR);
  const date = [
    startsAt.getFullYear(),
    String(startsAt.getMonth() + 1).padStart(2, "0"),
    String(startsAt.getDate()).padStart(2, "0"),
  ].join("-");
  await entry.getByLabel("Дата").fill(date);
  await entry.getByRole("button", { name: "Записать", exact: true }).click();
  await expect(page.getByText(/клиент записан/)).toBeVisible();
  await expect(card.getByText("4 занятия", { exact: true })).toBeVisible();

  const members = await owner.practice.members({ practiceId });
  expect(members.find((m) => m.role === "client")?.credits).toBe(4);
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

test("client moves a booking to a new time without losing the credit", async ({
  page,
  browser,
  baseURL,
}) => {
  // Two sign-ups, each of which may wait out the rate limit.
  test.setTimeout(180_000);
  const base = baseURL ?? "";
  const { api: owner, practiceId } = await ownerWithPractice(page, base);
  await owner.availability.replace({
    practiceId,
    rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      startMinute: 0,
      endMinute: 1440,
    })),
  });

  // The owner leaves a contact on the booking page's settings.
  const contact = "@anna-e2e";
  await page.goto(`/practices/${practiceId}/booking-page`);
  await page.getByLabel("Контакт для клиентов").fill(contact);
  await page
    .locator("form")
    .filter({ has: page.getByLabel("Контакт для клиентов") })
    .getByRole("button", { name: "Сохранить" })
    .click();
  await expect(page.getByText("Контакт сохранён")).toBeVisible();

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
  const inTime = hourAfter(72 * HOUR);
  await owner.booking.book({
    practiceId,
    memberId: member.id,
    startsAt: inTime,
  });

  await clientPage.goto("/bookings");
  await expect(clientPage.getByText(/Осталось 2 занятия/)).toBeVisible();

  // Next week is sure to have free times, this week's may be over.
  await clientPage.getByRole("button", { name: "Перенести" }).click();
  const dialog = clientPage.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Перенести запись" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Следующая неделя" }).click();
  await dialog
    .getByRole("button", { name: /^\d\d:\d\d$/ })
    .first()
    .click();
  await dialog.getByRole("button", { name: /^Перенести на / }).click();
  await expect(clientPage.getByText(/^Запись перенесена/)).toBeVisible();

  // One booking, at another time, and the same balance: nothing was cancelled.
  await expect(clientPage.getByText(/Осталось 2 занятия/)).toBeVisible();
  const bookings = await client.booking.mine();
  expect(bookings).toHaveLength(1);
  expect(bookings[0]?.status).toBe("active");
  const movedTo = bookings[0]?.startsAt.getTime();
  expect(movedTo).not.toBe(inTime.getTime());
  // `from` is a day in the practice's zone: a day either side covers any zone.
  const slots = await client.booking.slots({
    practiceId,
    from: new Date(inTime.getTime() - 24 * HOUR).toISOString().slice(0, 10),
    days: 3,
  });
  expect(slots.slots.map((s) => s.startsAt.getTime())).toContain(
    inTime.getTime(),
  );

  // Closer than 24 hours only the specialist can move it: their contact shows.
  await owner.booking.book({
    practiceId,
    memberId: member.id,
    startsAt: hourAfter(3 * HOUR),
  });
  await clientPage.reload();
  await clientPage.getByRole("button", { name: "Перенести" }).click();
  await expect(
    clientPage.getByRole("heading", { name: "Перенести уже нельзя" }),
  ).toBeVisible();
  await expect(clientPage.getByText(contact)).toBeVisible();

  await clientContext.close();
});

import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "e2e-password-123";

function uniqueEmail() {
  return `e2e-${crypto.randomUUID()}@example.com`;
}

async function fillPasswordForm(page: Page, email: string) {
  // The email code is the default; the password form is one click away.
  await page
    .getByRole("button", { name: /^(Войти|Зарегистрироваться) с паролем$/ })
    .click();
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
}

test("signs up, keeps the session and signs back in", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail();

  await page.goto("/auth/signup");
  await fillPasswordForm(page, email);
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();

  // "/" sends a newcomer (no practices yet) on to /practices.
  await expect(page).toHaveURL("/practices");
  await page.reload();
  await expect(page).toHaveURL("/practices");

  // A fresh browser context has no cookies: sign in with the same account.
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.goto("/auth/login");
  await fillPasswordForm(fresh, email);
  await fresh.getByRole("button", { name: "Войти", exact: true }).click();

  await expect(fresh).toHaveURL("/practices");
  await context.close();
});

test("rejects unknown credentials", async ({ page }) => {
  await page.goto("/auth/login");
  await fillPasswordForm(page, uniqueEmail());
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  await expect(
    page.locator("[data-sonner-toast][data-type='error']"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/login$/);
});

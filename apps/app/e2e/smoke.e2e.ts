import { expect, test } from "@playwright/test";

test("redirects anonymous visitors to the login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/auth\/login$/);
});

test("shows the 404 page at an unknown address", async ({ page }) => {
  const response = await page.goto("/auth/no-such-page");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Такой страницы нет" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "На главную" })).toBeVisible();
});

test("an unknown booking page doesn't lead to the cabinet", async ({
  page,
}) => {
  await page.goto("/p/no-such-practice");

  await expect(
    page.getByRole("heading", { name: "Страница записи не найдена" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "На главную" })).toHaveCount(0);
});

test("renders the login form", async ({ page }) => {
  await page.goto("/auth/login");

  await expect(page.getByText("С возвращением")).toBeVisible();
  // The email code comes first. Labels must be wired to the inputs
  // (FormLabel htmlFor → FormControl id).
  await expect(page.getByLabel("Электронная почта")).toHaveAttribute(
    "type",
    "email",
  );
  await expect(
    page.getByRole("button", { name: "Получить код" }),
  ).toBeVisible();

  // The password is the secondary way in.
  await page.getByRole("button", { name: "Войти с паролем" }).click();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Забыли пароль?" }),
  ).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("redirects anonymous visitors to the login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/auth\/login$/);
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

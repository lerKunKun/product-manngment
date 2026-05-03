import { test, expect } from "@playwright/test";

test.describe("Login flow", () => {
  test("admin/admin123 logs in successfully", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/用户名|username/i).or(page.getByPlaceholder(/用户名/i)).first().fill("admin");
    await page.getByLabel(/密码|password/i).or(page.getByPlaceholder(/密码/i)).first().fill("admin123");
    await page.getByRole("button", { name: /^登录$|^sign in$/i }).click();
    await expect(page).toHaveURL(/\/(dashboard|$)/, { timeout: 10_000 });
  });

  test("wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/用户名|username/i).or(page.getByPlaceholder(/用户名/i)).first().fill("admin");
    await page.getByLabel(/密码|password/i).or(page.getByPlaceholder(/密码/i)).first().fill("wrong-pass");
    await page.getByRole("button", { name: /^登录$|^sign in$/i }).click();
    await expect(page.getByText(/密码错误|认证失败|用户名或密码|invalid/i)).toBeVisible({ timeout: 5_000 });
  });
});

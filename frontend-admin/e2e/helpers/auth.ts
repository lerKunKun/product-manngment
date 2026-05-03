import type { Page } from "@playwright/test";

export async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  const username = page.getByLabel(/用户名|username/i).or(page.getByPlaceholder(/用户名/i)).first();
  const password = page.getByLabel(/密码|password/i).or(page.getByPlaceholder(/密码/i)).first();
  await username.fill("admin");
  await password.fill("admin123");
  await page.getByRole("button", { name: /^登录$|^sign in$/i }).click();
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 10_000 });
}

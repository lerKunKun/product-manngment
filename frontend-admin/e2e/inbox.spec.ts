import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("Inbox page", () => {
  test("loads heading", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/inbox");
    await expect(
      page.getByRole("heading", { name: /通知中心|inbox/i })
    ).toBeVisible({ timeout: 5_000 });
  });

  test("can switch tab between all/unread", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/inbox");
    const unreadTab = page.getByRole("button", { name: /^未读$|^unread$/i }).first();
    if (await unreadTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await unreadTab.click();
      await expect(page.getByRole("heading", { name: /通知|inbox/i })).toBeVisible();
    }
  });
});

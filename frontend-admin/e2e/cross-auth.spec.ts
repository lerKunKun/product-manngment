import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("Cross-Company Auth page", () => {
  test("loads heading and toolbar", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/cross-auth");
    await expect(
      page.getByRole("heading", { name: /跨公司授权|cross.company/i })
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: /新建跨公司授权|create/i }).first()
    ).toBeVisible();
  });

  test("status filter clickable", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/cross-auth");
    const activeBtn = page.getByRole("button", { name: /^生效$|^active$/i }).first();
    if (await activeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await activeBtn.click();
      await expect(page.getByRole("heading", { name: /跨公司|cross/i })).toBeVisible();
    }
  });
});

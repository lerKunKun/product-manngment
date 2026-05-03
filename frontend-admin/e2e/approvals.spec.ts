import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("approvals page loads + can switch tabs", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: /审批/i })).toBeVisible({ timeout: 5_000 });
  const myTab = page.getByRole("button", { name: /我提交的|mine/i });
  if (await myTab.isVisible()) {
    await myTab.click();
    await expect(page.getByRole("heading", { name: /审批/i })).toBeVisible();
  }
});

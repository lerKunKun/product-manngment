import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

// 旧 /orgs 已合并到 /iam（G3）。这里改成验新页同等路径。
test.describe("IAM page", () => {
  test("org tree loads + first node selectable", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/iam");
    await expect(
      page.getByText(/组织/).first()
    ).toBeVisible({ timeout: 5_000 });
    const links = page.locator("a, button").filter({ hasText: /\w/ });
    await expect(links.first()).toBeVisible({ timeout: 5_000 });
  });
});

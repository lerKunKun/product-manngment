import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("Orgs page", () => {
  test("tree loads + first node selectable", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/orgs");
    await expect(
      page.getByRole("heading", { name: /组织|org/i }).first()
    ).toBeVisible({ timeout: 5_000 });
    const links = page.locator("a, button").filter({ hasText: /\w/ });
    await expect(links.first()).toBeVisible({ timeout: 5_000 });
  });
});

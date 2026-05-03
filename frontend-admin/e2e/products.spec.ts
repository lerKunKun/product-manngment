import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("products list loads", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: /产品库|products/i })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("text=Handle").or(page.locator("text=SKU")).or(page.locator("text=标题")).first()).toBeVisible({ timeout: 5_000 });
});

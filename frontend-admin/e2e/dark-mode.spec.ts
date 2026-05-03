import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("Dark mode", () => {
  test("toggle adds .dark class on html", async ({ page }) => {
    await loginAsAdmin(page);

    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      try { localStorage.removeItem("theme"); } catch {}
    });
    await page.reload();
    await expect.poll(async () =>
      await page.evaluate(() => document.documentElement.classList.contains("dark"))
    ).toBe(false);

    const themeBtn = page.getByRole("button", { name: /切换主题|toggle theme/i }).first();
    await themeBtn.click();

    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );
    expect(isDark).toBe(true);

    await page.reload();
    const stillDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );
    expect(stillDark).toBe(true);

    await themeBtn.click();
  });
});

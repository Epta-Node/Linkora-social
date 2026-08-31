import { test, expect } from "@playwright/test";
import { injectWalletMock } from "./test-utils";

test.describe("Pool Flow", () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page);
  });

  test("pools page loads with heading", async ({ page }) => {
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Community Pools" })).toBeVisible({
      timeout: 10000,
    });
  });

  test("pools page renders content area", async ({ page }) => {
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 10000 });
  });
});

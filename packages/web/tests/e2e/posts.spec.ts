import { test, expect } from "@playwright/test";
import { injectWalletMock, connectWallet, navigateToFeed } from "./test-utils";

test.describe("Post Creation & Feed", () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page);
    await page.goto("/");
    await connectWallet(page);
  });

  test("feed page loads after wallet connect", async ({ page }) => {
    await navigateToFeed(page);
    await page.waitForLoadState("networkidle");
    const content = page.locator('[data-testid="feed"], article, main').first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("feed page renders without errors", async ({ page }) => {
    await navigateToFeed(page);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main").first()).toBeVisible({ timeout: 10000 });
  });
});

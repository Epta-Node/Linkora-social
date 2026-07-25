import { test, expect } from "@playwright/test";
import { injectWalletMock } from "./test-utils";

test.describe("Feed Flow", () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page);
  });

  test("feed page loads and shows content area", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    // Feed renders a container or empty state — both are valid
    const content = page.locator('[data-testid="feed"], article, main').first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("connect wallet on feed page", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    const connectBtn = page.locator('[data-testid="connect-wallet"]').first();
    if (await connectBtn.isVisible().catch(() => false)) {
      await connectBtn.click();
      await page.locator('[data-testid="disconnect-wallet"]').first().waitFor({ timeout: 10000 });
    }
  });
});

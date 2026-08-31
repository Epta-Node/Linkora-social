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
    const addressChip = page.locator('[data-testid="wallet-address"]').first();
    // The injected wallet mock auto-connects on page load, so the wallet may
    // already be connected. Only click Connect if it is not, then assert the
    // connected state either way.
    if (!(await addressChip.isVisible().catch(() => false))) {
      if (await connectBtn.isVisible().catch(() => false)) {
        await connectBtn.click();
      }
    }
    await expect(addressChip).toBeVisible({ timeout: 10000 });
  });
});

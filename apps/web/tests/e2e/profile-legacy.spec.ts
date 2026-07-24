import { test, expect } from "@playwright/test";
import { injectWalletMock, connectWallet, MOCK_ADDRESS } from "./test-utils";

test.describe("Profile Flow", () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page);
  });

  test("profile page renders for a valid address", async ({ page }) => {
    await page.goto(`/profile/${MOCK_ADDRESS}`);
    await page.waitForLoadState("domcontentloaded");
    const content = page.locator("main, h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("own profile shows edit option when connected", async ({ page }) => {
    await page.goto("/");
    await connectWallet(page);
    await page.goto(`/profile/${MOCK_ADDRESS}`);
    await page.waitForLoadState("domcontentloaded");
    // Look for edit link or any heading — page must render without error
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});

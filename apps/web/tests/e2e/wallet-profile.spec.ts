import { test, expect } from "@playwright/test";
import {
  injectWalletMock,
  connectWallet,
  waitForWalletConnection,
  navigateToProfile,
  MOCK_ADDRESS,
} from "./test-utils";

test.describe("Wallet Connection & Profile Registration", () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page);
    await page.goto("/");
  });

  test("connect wallet → verify connected address shown in header", async ({ page }) => {
    await connectWallet(page);
    const addressBadge = page.locator('[data-testid="wallet-address"]').first();
    await expect(addressBadge).toBeVisible({ timeout: 10000 });
  });

  test("connect wallet → navigate to profile page", async ({ page }) => {
    await connectWallet(page);
    const address = await waitForWalletConnection(page);
    expect(address).toBeTruthy();

    await navigateToProfile(page, MOCK_ADDRESS);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain(MOCK_ADDRESS);
  });

  test("disconnect wallet", async ({ page }) => {
    await connectWallet(page);
    const disconnectButton = page.locator('[data-testid="disconnect-wallet"]').first();
    await expect(disconnectButton).toBeVisible({ timeout: 10000 });
    await disconnectButton.click();
    await expect(page.locator('[data-testid="connect-wallet"]').first()).toBeVisible({
      timeout: 10000,
    });
  });
});

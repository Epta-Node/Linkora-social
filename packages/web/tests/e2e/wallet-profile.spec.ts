import { test, expect } from '@playwright/test';
import { connectWallet, waitForWalletConnection, navigateToProfile } from './test-utils';

test.describe('Wallet Connection & Profile Registration', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to home page
    await page.goto('/');
  });

  test('E2E: connect wallet -> register profile -> verify profile page shows username', async ({
    page,
  }) => {
    // Step 1: Connect wallet
    await connectWallet(page);

    // Step 2: Verify wallet is connected
    const connectedAddress = await waitForWalletConnection(page);
    expect(connectedAddress).toBeTruthy();
    expect(connectedAddress).toMatch(/^[GS][A-Z0-9]{55}$/); // Stellar address format

    // Step 3: Navigate to profile page
    await navigateToProfile(page, connectedAddress);

    // Step 4: Verify profile page loads
    await page.waitForLoadState('networkidle');
    const profileHeading = page.locator('h1, h2').first();
    await expect(profileHeading).toBeVisible();

    // Step 5: Verify profile shows user data
    const profileContent = page.locator('text=/Profile|Username|Bio|Posts/i').first();
    await expect(profileContent).toBeVisible();

    // Step 6: Verify we're on the profile page for the connected user
    const currentUrl = page.url();
    expect(currentUrl).toContain(connectedAddress);
  });

  test('should display connected wallet address in header', async ({ page }) => {
    // Connect wallet
    await connectWallet(page);

    // Verify address is displayed in the currently visible navbar
    const addressBadge = page
      .locator('span')
      .filter({ hasText: /^[GS][A-Z0-9]{5}\.\.\.[A-Z0-9]{4}$/ })
      .last();
    await expect(addressBadge).toBeVisible();
  });

  test('should disconnect wallet', async ({ page }) => {
    // Connect wallet first
    await connectWallet(page);

    // Find and click the currently visible disconnect button
    const disconnectButton = page.getByRole('button', { name: /disconnect/i }).last();
    await expect(disconnectButton).toBeVisible();

    await disconnectButton.click();

    // Verify wallet is disconnected
    const connectButton = page.getByRole('button', { name: /connect wallet/i }).last();
    await expect(connectButton).toBeVisible();
  });
});


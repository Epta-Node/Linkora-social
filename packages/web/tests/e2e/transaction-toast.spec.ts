import { test, expect } from '@playwright/test';
import { connectWallet, tipPost } from './test-utils';

test.describe('Transaction toast sequence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await connectWallet(page);
  });

  test('shows pending then success toast with Stellar Expert link when tipping', async ({ page }) => {
    await page.goto('/feed');
    await page.waitForLoadState('networkidle');

    // Start tip flow
    await tipPost(page, 0.1);

    // Pending toast appears (Waiting for signature...)
    const pending = page.locator('[role="status"]', { hasText: 'Waiting for signature' }).first();
    await expect(pending).toBeVisible({ timeout: 5000 });

    // Then success toast appears
    const success = page.locator('[role="status"]', { hasText: 'Transaction confirmed' }).first();
    await expect(success).toBeVisible({ timeout: 10000 });

    // Verify Stellar Expert link exists on success toast
    const link = success.locator('a[href*="stellar.expert"]');
    await expect(link).toHaveCount(1);
  });
});

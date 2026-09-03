import { Page, expect } from "@playwright/test";

const MOCK_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

export async function injectWalletMock(page: Page): Promise<void> {
  await page.addInitScript((address) => {
    window.localStorage.setItem("linkora_guided_tour_dismissed", "true");
    // Mark onboarding as complete so the OnboardingGuard never redirects
    // connected test wallets to /onboarding (which covers the whole page and
    // blocks clicks on the search suggestions dropdown).
    window.localStorage.setItem(
      "linkora_onboarding_state",
      JSON.stringify({
        isComplete: true,
        currentStep: 5,
        completedSteps: {
          welcome: true,
          profile: true,
          follow: true,
          notifications: true,
          explore: true,
        },
        skipped: true,
      })
    );
    window.localStorage.setItem("linkora_wallet_public_key", address);
    window.localStorage.setItem("linkora_wallet_address", address);
    window.localStorage.setItem("linkora_wallet_network", "TESTNET");
    (window as Window & { freighterApi?: unknown; freighter?: unknown }).freighterApi = {
      getPublicKey: () => Promise.resolve(address),
      isConnected: () => Promise.resolve(true),
      onNetworkChange: () => {},
    };
    (window as Window & { freighter?: unknown }).freighter = {
      getPublicKey: () => Promise.resolve(address),
      isConnected: () => Promise.resolve(true),
    };
  }, MOCK_ADDRESS);
}

export async function waitForWalletConnection(page: Page, timeout = 15000): Promise<string> {
  const initialStored = await page.evaluate(() =>
    localStorage.getItem("linkora_wallet_public_key")
  );
  if (initialStored) return initialStored;

  try {
    await page.locator('[data-testid="wallet-address"]').first().waitFor({ timeout });
  } catch {
    // Nothing found — fall through to localStorage check below.
  }

  const storedAddress = await page.evaluate(() =>
    localStorage.getItem("linkora_wallet_public_key")
  );
  if (storedAddress) return storedAddress;

  const headerAddress = await page
    .locator('[data-testid="wallet-address"]')
    .first()
    .textContent()
    .catch(() => null);
  return storedAddress ?? headerAddress ?? "";
}

/**
 * Ensures the page is in a connected-wallet state.
 *
 * When the wallet mock pre-sets localStorage (the default), the WalletProvider
 * rehydrates on page load and the NavBar shows the address chip immediately.
 * In that case this function simply waits for the address chip to appear.
 *
 * If no wallet data exists yet, it falls back to clicking a Connect button.
 */
export async function connectWallet(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");

  await page.waitForTimeout(500);

  const skipTourButton = page.locator('button:has-text("Skip tour")').first();
  if (await skipTourButton.isVisible().catch(() => false)) {
    await skipTourButton.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  // Fast path: wallet already connected via localStorage — just wait for the
  // address chip to confirm the UI reflects the connected state.
  const addressChip = page.locator('[data-testid="wallet-address"]').first();
  try {
    await addressChip.waitFor({ state: "visible", timeout: 8000 });
    return;
  } catch {
    // Address chip not found — wallet is not yet connected. Continue to
    // look for a Connect button.
  }

  // Slow path: wallet not connected yet — try to click a Connect button.
  const hamburgerSelectors = [
    '[aria-label="Toggle navigation menu"]',
    '[aria-label*="Toggle"]',
    '[aria-label*="toggle"]',
    'button[aria-label*="menu"]',
    'button[aria-label*="navigation"]',
  ];

  for (const selector of hamburgerSelectors) {
    const hamburger = page.locator(selector).first();
    if (await hamburger.isVisible().catch(() => false)) {
      await hamburger.click();
      await page.waitForTimeout(600);
      break;
    }
  }

  const connectSelectors = [
    '[data-testid="connect-wallet"]',
    '[data-testid*="connect"]',
    'button:has-text("Connect Wallet")',
    'button:has-text("Connect")',
  ];

  let connectButton: ReturnType<Page["locator"]> | null = null;

  for (const selector of connectSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      connectButton = locator;
      break;
    }
  }

  if (!connectButton) {
    for (const selector of connectSelectors) {
      const locator = page.locator(selector).first();
      try {
        await locator.waitFor({ state: "visible", timeout: 8000 });
        connectButton = locator;
        break;
      } catch {
        // Try the next selector.
      }
    }
  }

  if (connectButton) {
    await expect(connectButton).toBeVisible({ timeout: 10000 });
    await connectButton.click();
    await waitForWalletConnection(page);
  }
  // If no Connect button exists and address chip was not found either, the
  // page may be in an unexpected state — waitForWalletConnection will handle
  // the final timeout if needed.
}

/**
 * Opens the WalletModal and clicks the Disconnect button inside it.
 */
export async function disconnectWallet(page: Page): Promise<void> {
  const addressChip = page.locator('[data-testid="wallet-address"]').first();
  await expect(addressChip).toBeVisible({ timeout: 10000 });
  await addressChip.click();

  const walletModal = page.locator('[data-testid="wallet-modal"]');
  await expect(walletModal).toBeVisible({ timeout: 5000 });

  const disconnectButton = walletModal.locator('button:has-text("Disconnect")');
  await expect(disconnectButton).toBeVisible({ timeout: 5000 });
  await disconnectButton.click();

  await expect(addressChip).toBeHidden({ timeout: 10000 });
}

export async function navigateToProfile(page: Page, address: string): Promise<void> {
  await page.goto(`/profile/${address}`);
}

export async function navigateToPostDetail(page: Page, postId: string): Promise<void> {
  await page.goto(`/posts/${postId}`);
}

export async function navigateToFeed(page: Page): Promise<void> {
  await page.goto("/feed");
}

export async function createPost(page: Page, content: string): Promise<void> {
  const composeButton = page
    .locator(
      'button:has-text("Compose"), button:has-text("New Post"), button:has-text("Create Post")'
    )
    .first();
  await composeButton.click();

  const dialog = page.locator('[role="dialog"]');
  const isDialogVisible = await dialog.isVisible();
  const textarea = isDialogVisible
    ? dialog.locator("textarea").first()
    : page.locator("textarea").first();
  await textarea.fill(content);

  const submitButton = isDialogVisible
    ? dialog
        .locator('button[type="submit"], button[form="compose-form"], button:has-text("Post")')
        .first()
    : page.locator('button[form="compose-form"], button[type="submit"]').first();
  await submitButton.click();
  await page.waitForTimeout(1000);
}

export async function waitForPostInFeed(
  page: Page,
  content: string,
  timeout = 10000
): Promise<void> {
  await page.locator(`text="${content}"`).first().waitFor({ timeout });
}

export async function clickPostInFeed(page: Page, content: string): Promise<void> {
  await page.locator(`article:has-text("${content}")`).first().click();
}

export async function tipPost(page: Page, amount = 1): Promise<void> {
  const tipButton = page.locator('button:has-text("Tip"), button:has-text("Support")').first();
  await tipButton.click();

  const amountInput = page.locator('input[type="number"]').first();
  if (await amountInput.isVisible()) {
    await amountInput.fill(amount.toString());
  }

  await page.locator('button:has-text("Confirm"), button:has-text("Send")').first().click();
  await page.waitForTimeout(2000);
}

export { MOCK_ADDRESS };

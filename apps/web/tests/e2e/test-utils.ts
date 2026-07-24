import { Page, expect } from "@playwright/test";

const MOCK_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

export async function injectWalletMock(page: Page): Promise<void> {
  await page.addInitScript((address) => {
    window.localStorage.setItem("linkora_guided_tour_dismissed", "true");
    (window as Window & { freighterApi?: unknown; freighter?: unknown }).freighterApi = {
      getPublicKey: () => Promise.resolve({ publicKey: address }),
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
  await page.locator('[data-testid="disconnect-wallet"]').waitFor({ timeout });
  const storedAddress = await page.evaluate(() =>
    localStorage.getItem("linkora_wallet_public_key")
  );
  return (
    storedAddress ??
    (await page.locator('[data-testid="wallet-address"]').first().textContent()) ??
    ""
  );
}

export async function connectWallet(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");

  const skipTourButton = page.locator('button:has-text("Skip tour")').first();
  if (await skipTourButton.isVisible().catch(() => false)) {
    await skipTourButton.click().catch(() => {});
    await page.waitForTimeout(300);
  }

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

  if (!connectButton) {
    throw new Error(`Connect wallet button not found. Tried: ${connectSelectors.join(", ")}`);
  }

  await expect(connectButton).toBeVisible({ timeout: 10000 });
  await connectButton.click();
  await waitForWalletConnection(page);
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

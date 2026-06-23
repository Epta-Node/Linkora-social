import { Page } from '@playwright/test';

/**
 * Utility functions for E2E tests
 */

const STORAGE_KEY = 'linkora_wallet_public_key';
const MOCK_WALLET_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

async function installMockWallet(page: Page, publicKey = MOCK_WALLET_ADDRESS): Promise<void> {
  const scriptArg = { publicKey, storageKey: STORAGE_KEY };

  await page.addInitScript(({ publicKey: key, storageKey }) => {
    const freighterApi = {
      getPublicKey: async () => ({ publicKey: key }),
      isConnected: async () => true,
      onNetworkChange: () => undefined,
    };

    const freighter = {
      getPublicKey: async () => key,
    };

    Object.defineProperty(window, 'freighterApi', {
      configurable: true,
      value: freighterApi,
    });

    Object.defineProperty(window, 'freighter', {
      configurable: true,
      value: freighter,
    });

    window.localStorage.setItem(storageKey, key);
  }, scriptArg);

  await page.evaluate(({ publicKey: key, storageKey }) => {
    const win = window as Window & {
      freighter?: { getPublicKey: () => Promise<string> };
      freighterApi?: {
        getPublicKey: () => Promise<{ publicKey: string }>;
        isConnected: () => Promise<boolean>;
        onNetworkChange: (callback: () => void) => void;
      };
    };

    win.freighterApi = {
      getPublicKey: async () => ({ publicKey: key }),
      isConnected: async () => true,
      onNetworkChange: () => undefined,
    };

    win.freighter = {
      getPublicKey: async () => key,
    };

    window.localStorage.setItem(storageKey, key);
  }, scriptArg);
}

async function getVisibleConnectWalletButton(page: Page) {
  const connectButtons = page.getByRole('button', { name: /connect wallet/i });
  const firstButton = connectButtons.first();

  if (await firstButton.isVisible().catch(() => false)) {
    return firstButton;
  }

  const navToggle = page.getByRole('button', { name: /toggle navigation menu/i });
  if (await navToggle.isVisible().catch(() => false)) {
    await navToggle.click();
  }

  return page.getByRole('button', { name: /connect wallet/i }).last();
}

/**
 * Wait for wallet to be connected and return the connected address
 */
export async function waitForWalletConnection(page: Page, timeout = 10000): Promise<string> {
  try {
    await page.waitForFunction(
      (storageKey) => window.localStorage.getItem(storageKey),
      STORAGE_KEY,
      { timeout }
    );

    const addressText = await page.evaluate(
      (storageKey) => window.localStorage.getItem(storageKey),
      STORAGE_KEY
    );

    if (!addressText) {
      throw new Error('Wallet storage key is empty after connection.');
    }

    return addressText;
  } catch (e) {
    throw new Error(`Failed to detect wallet connection within ${timeout}ms`);
  }
}

/**
 * Connect wallet by clicking Connect Wallet button
 */
export async function connectWallet(page: Page): Promise<void> {
  await installMockWallet(page);

  const connectButton = await getVisibleConnectWalletButton(page);
  await connectButton.click();

  // Wait for wallet to be connected
  await waitForWalletConnection(page);
}

/**
 * Navigate to profile page for a given address
 */
export async function navigateToProfile(page: Page, address: string): Promise<void> {
  await page.goto(`/profile/${address}`);
}

/**
 * Navigate to post detail page
 */
export async function navigateToPostDetail(page: Page, postId: string): Promise<void> {
  await page.goto(`/posts/${postId}`);
}

/**
 * Navigate to feed page
 */
export async function navigateToFeed(page: Page): Promise<void> {
  await page.goto('/feed');
}

/**
 * Fill and submit create post form
 */
export async function createPost(page: Page, content: string): Promise<void> {
  // Click compose button or navigate to create post
  const composeButton = page.locator('button:has-text("Compose"), button:has-text("New Post")').first();
  await composeButton.click();

  // Fill post content
  const textarea = page.locator('textarea').first();
  await textarea.fill(content);

  // Submit
  const submitButton = page.locator('button:has-text("Post"), button:has-text("Submit")').first();
  await submitButton.click();

  // Wait for post to appear
  await page.waitForTimeout(1000);
}

/**
 * Wait for post to appear in feed with specific content
 */
export async function waitForPostInFeed(page: Page, content: string, timeout = 5000): Promise<void> {
  await page.locator(`text="${content}"`).first().waitFor({ timeout });
}

/**
 * Click on a post in the feed to view details
 */
export async function clickPostInFeed(page: Page, content: string): Promise<void> {
  const post = page.locator(`article:has-text("${content}")`).first();
  await post.click();
}

/**
 * Tip a post by clicking tip button
 */
export async function tipPost(page: Page, amount = 1): Promise<void> {
  const tipButton = page.locator('button:has-text("Tip"), button:has-text("Support")').first();
  await tipButton.click();

  // If there's an input for amount
  const amountInput = page.locator('input[type="number"]').first();
  if (await amountInput.isVisible()) {
    await amountInput.fill(amount.toString());
  }

  // Click confirm
  const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Send")').first();
  await confirmButton.click();

  // Wait for transaction to complete
  await page.waitForTimeout(2000);
}

/**
 * Wait for element and return its text content
 */
export async function getElementText(page: Page, selector: string): Promise<string | null> {
  return page.locator(selector).first().textContent();
}

/**
 * Verify that a URL contains a specific path
 */
export async function verifyUrl(page: Page, expectedPath: string): Promise<boolean> {
  const url = page.url();
  return url.includes(expectedPath);
}

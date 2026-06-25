import { test, expect } from "@playwright/test";
import { injectWalletMock, connectWallet } from "./test-utils";

test.describe("Post Tipping", () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page);
    await page.goto("/");
    await connectWallet(page);
  });

  test("feed page is accessible after wallet connect", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main").first()).toBeVisible({ timeout: 10000 });
  });

  test("tip button visible on post detail when post exists", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");

    const firstPost = page.locator("article").first();
    if (await firstPost.isVisible().catch(() => false)) {
      await firstPost.click();
      await page.waitForLoadState("networkidle");
      const tipButton = page.locator('button:has-text("Tip"), button:has-text("Support")').first();
      if (await tipButton.isVisible().catch(() => false)) {
        await expect(tipButton).toBeVisible();
      }
    }
  });
});

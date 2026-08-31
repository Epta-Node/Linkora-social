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

  test("tip button visible on a feed post when one exists", async ({ page }) => {
    // Tipping happens on the feed card itself (components/PostCard.tsx) — there
    // is no tip control on the post detail page, so we assert directly on the
    // feed rather than navigating into a post.
    await page.goto("/feed");
    await page.waitForLoadState("networkidle");

    const firstPost = page.locator("article").first();
    const hasPost = await firstPost.isVisible().catch(() => false);
    // This environment has no seeded feed data and post creation requires a
    // real wallet signature (not mocked here), so an empty feed is a valid
    // state — skip explicitly instead of silently passing with no assertions.
    test.skip(!hasPost, "No posts in feed to verify the tip button against");

    const tipButton = firstPost.locator('button[aria-label="Tip creator"]');
    await expect(tipButton).toBeVisible();
  });
});

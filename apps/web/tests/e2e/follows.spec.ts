import { test, expect } from "@playwright/test";
import { injectWalletMock } from "./test-utils";

test.describe("Follows Flow", () => {
  const targetAddress = "GAHECF2UDYZSEO7RSIV24ZDVEFMF3IPKDJ65O54NQDUXG2JL6A35IOSG";
  const currentUserAddress = "GBSIBPRUU5B3R6P7NFLGSHACVZFW37K46RUO3RVXQB4AIEI6UADWGV2V";

  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page);
    await page.goto(`/profile/${targetAddress}`, { waitUntil: "domcontentloaded" });
    await page.evaluate((key) => {
      localStorage.setItem("linkora_wallet_public_key", key);
    }, currentUserAddress);
  });

  test("Navigate to followers list, search/filter users, and navigate back", async ({ page }) => {
    // 1. Visit the profile page
    await page.goto(`/profile/${targetAddress}`, { waitUntil: "domcontentloaded" });

    // 2. Click the Followers link in the profile header
    const followersLink = page
      .locator(`a[href="/profile/${targetAddress}/followers"]`)
      .filter({ hasText: /followers/i })
      .first();
    await expect(followersLink).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(new RegExp(`/profile/${targetAddress}/followers`)),
      followersLink.click(),
    ]);

    // 3. Verify URL and list title
    await expect(page.locator("h1")).toHaveText("Followers");

    // 4. Verify search/filter functionality using an actual rendered username
    const searchInput = page.getByPlaceholder("Filter by username...");
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    const firstUserLink = page.locator('ul[role="list"] li a[href^="/profile/"]').first();
    await expect(firstUserLink).toBeVisible({ timeout: 15000 });
    const firstUsername = (await firstUserLink.textContent())?.replace(/^@/, "").trim() || "";
    expect(firstUsername).toBeTruthy();

    const filterTerm = firstUsername.slice(0, Math.min(6, firstUsername.length));
    await searchInput.fill(filterTerm);
    await expect(firstUserLink).toContainText(firstUsername);

    // Type a non-existent username
    await searchInput.fill("nonexistent_user_xyz");
    await expect(page.locator("text=No accounts found.")).toBeVisible({ timeout: 15000 });

    // 5. Navigate back to the profile page using the back link
    const backLink = page.locator('a:has-text("Back to Profile")');
    await expect(backLink).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(new RegExp(`/profile/${targetAddress}$`)),
      backLink.click(),
    ]);
  });

  test("Navigate to following list and verify inline follow/unfollow optimistic updates", async ({
    page,
  }) => {
    // 1. Visit the following page directly
    await page.goto(`/profile/${targetAddress}/following`, { waitUntil: "domcontentloaded" });
    const list = page.locator('ul[role="list"]');
    await expect(list).toBeVisible({ timeout: 15000 });

    // 2. Find a user list item (should have followers/following loaded)
    const listItems = page.locator('ul[role="list"] > li');
    await expect(listItems.first()).toBeVisible({ timeout: 15000 });

    // 3. Locate the follow button for the first user
    const firstItem = listItems.first();
    const followButton = firstItem.locator("button");
    await expect(followButton).toBeVisible({ timeout: 15000 });

    const initialText = await followButton.textContent();
    const isInitiallyFollowing = initialText?.trim() === "Following";

    // 4. Click follow button and verify optimistic UI update
    await followButton.click();

    if (isInitiallyFollowing) {
      // Should instantly change to Follow
      await expect(followButton).toHaveText(/Follow/i);
    } else {
      // Should instantly change to Following
      await expect(followButton).toHaveText(/Following/i);
    }
  });

  test("Keyboard accessibility on follows page", async ({ page }) => {
    // 1. Go to following page
    await page.goto(`/profile/${targetAddress}/following`, { waitUntil: "domcontentloaded" });
    const searchInput = page.getByPlaceholder("Filter by username...");
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    // 2. Focus on search input using tab
    await searchInput.focus();

    // 3. Check ARIA attributes
    const list = page.locator('ul[role="list"]').first();
    await expect(list).toHaveAttribute("aria-label", "Following list");

    const firstItem = page.locator('ul[role="list"] > li').first();
    await expect(firstItem).toHaveAttribute("role", "listitem");
    await expect(firstItem).toHaveAttribute("tabindex", "0");
  });
});

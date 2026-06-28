import { expect, test } from "@playwright/test";

test.describe("Search Suggestions", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the profiles search API for suggestions
    await page.route("**/api/profiles/search?**", async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get("q") || "";

      if (query.toLowerCase().includes("alice")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            profiles: [
              {
                address: "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                username: "alice",
                display_name: "Alice Wonder",
              },
              {
                address: "GALICEDEV234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                username: "alice_dev",
                display_name: "Alice Developer",
              },
            ],
          }),
        });
      } else {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ profiles: [] }),
        });
      }
    });

    // Mock the main search API
    await page.route("**/api/search/posts?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          posts: [
            {
              id: "test-post",
              author: "GALICE1234567890",
              content: "Test post content",
              tip_total: 10,
              timestamp: 1_738_368_000,
            },
          ],
        }),
      });
    });

    await page.goto("/");
  });

  test("shows recent searches when search bar is focused with empty query", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");
    const searchButton = page.getByRole("search").first().getByRole("button", { name: "Search" });

    // Perform a search to create recent history
    await searchBox.fill("test query");
    await searchButton.click();
    await expect(page).toHaveURL(/\/search\?q=test\+query/);

    // Go back to home
    await page.goto("/");

    // Focus the search bar without typing
    await searchBox.focus();

    // Should show recent searches dropdown
    await expect(page.getByText("Recent Searches")).toBeVisible();
    await expect(page.getByText("test query")).toBeVisible();
  });

  test("shows profile suggestions as user types", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    // Type to trigger suggestions
    await searchBox.fill("ali");

    // Wait for debounce and API call
    await page.waitForTimeout(400);

    // Should show profile suggestions
    await expect(page.getByText("Alice Wonder")).toBeVisible();
    await expect(page.getByText("Alice Developer")).toBeVisible();
    await expect(page.getByText("Profile").first()).toBeVisible();
  });

  test("highlights matching text in suggestions", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    await searchBox.fill("alice");
    await page.waitForTimeout(400);

    // Check for highlighted text
    const suggestions = page.locator("#search-suggestions");
    await expect(suggestions.locator("mark").first()).toBeVisible();
  });

  test("can click on a suggestion to perform search", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    await searchBox.fill("ali");
    await page.waitForTimeout(400);

    // Click on the first suggestion
    await page.getByText("Alice Wonder").click();

    // Should navigate to search results
    await expect(page).toHaveURL(/\/search\?q=Alice\+Wonder/);
  });

  test("keyboard navigation works in suggestions", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    await searchBox.fill("ali");
    await page.waitForTimeout(400);

    // Navigate down
    await searchBox.press("ArrowDown");

    // First suggestion should be highlighted
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toHaveClass(/bg-\[var\(--muted\)\]/);

    // Press Enter to select
    await searchBox.press("Enter");

    // Should navigate to search results
    await expect(page).toHaveURL(/\/search/);
  });

  test("escape key closes suggestions dropdown", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    await searchBox.fill("ali");
    await page.waitForTimeout(400);

    await expect(page.getByText("Alice Wonder")).toBeVisible();

    // Press Escape
    await searchBox.press("Escape");

    // Dropdown should be hidden
    await expect(page.getByText("Alice Wonder")).toBeHidden();
  });

  test("can clear recent searches", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");
    const searchButton = page.getByRole("search").first().getByRole("button", { name: "Search" });

    // Perform searches to create history
    await searchBox.fill("test 1");
    await searchButton.click();
    await page.goto("/");

    await searchBox.fill("test 2");
    await searchButton.click();
    await page.goto("/");

    // Focus search bar to show recent searches
    await searchBox.focus();
    await expect(page.getByText("test 2")).toBeVisible();

    // Click "Clear recent" button
    await page.getByRole("button", { name: "Clear recent searches" }).click();

    // Recent searches should be cleared
    await expect(page.getByText("test 2")).toBeHidden();
    await expect(page.getByText("Recent Searches")).toBeHidden();
  });

  test("can remove individual recent searches", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");
    const searchButton = page.getByRole("search").first().getByRole("button", { name: "Search" });

    // Create multiple recent searches
    await searchBox.fill("test 1");
    await searchButton.click();
    await page.goto("/");

    await searchBox.fill("test 2");
    await searchButton.click();
    await page.goto("/");

    // Focus to show recent searches
    await searchBox.focus();
    await expect(page.getByText("test 2")).toBeVisible();
    await expect(page.getByText("test 1")).toBeVisible();

    // Remove first recent search
    const removeButtons = page.locator(
      '[aria-label*="Remove"][aria-label*="from recent searches"]'
    );
    await removeButtons.first().click();

    // First search should be removed
    await expect(page.getByText("test 2")).toBeHidden();
    await expect(page.getByText("test 1")).toBeVisible();
  });

  test("hashtag suggestions appear for queries starting with #", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    await searchBox.fill("#stellar");
    await page.waitForTimeout(400);

    // Should show hashtag suggestion
    await expect(page.getByText("#stellar").first()).toBeVisible();
    await expect(page.getByText("Hashtag")).toBeVisible();
  });

  test("shows loading indicator while fetching suggestions", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    // Start typing
    await searchBox.fill("alice");

    // Loading indicator should appear briefly
    await expect(page.getByText("Loading suggestions...")).toBeVisible({ timeout: 200 });
  });

  test("clicking outside closes the dropdown", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");

    await searchBox.fill("ali");
    await page.waitForTimeout(400);

    await expect(page.getByText("Alice Wonder")).toBeVisible();

    // Click outside
    await page.locator("body").click({ position: { x: 10, y: 10 } });

    // Dropdown should close
    await expect(page.getByText("Alice Wonder")).toBeHidden();
  });

  test("stores last 10 searches in localStorage", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");
    const searchButton = page.getByRole("search").first().getByRole("button", { name: "Search" });

    // Perform 12 searches
    for (let i = 1; i <= 12; i++) {
      await searchBox.fill(`test ${i}`);
      await searchButton.click();
      await page.goto("/");
    }

    // Focus to show recent searches
    await searchBox.focus();

    // Should only show last 10
    await expect(page.getByText("test 12")).toBeVisible();
    await expect(page.getByText("test 3")).toBeVisible();
    await expect(page.getByText("test 2")).toBeHidden();
    await expect(page.getByText("test 1")).toBeHidden();
  });

  test("recent searches persist across page reloads", async ({ page }) => {
    const searchBox = page.getByRole("search").first().getByRole("textbox");
    const searchButton = page.getByRole("search").first().getByRole("button", { name: "Search" });

    // Perform a search
    await searchBox.fill("persistent search");
    await searchButton.click();

    // Reload the page
    await page.reload();

    // Focus search bar
    const reloadedSearchBox = page.getByRole("search").first().getByRole("textbox");
    await reloadedSearchBox.focus();

    // Recent search should still be there
    await expect(page.getByText("persistent search")).toBeVisible();
  });
});

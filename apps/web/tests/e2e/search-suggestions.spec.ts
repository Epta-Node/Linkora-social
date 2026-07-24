import { expect, test } from "@playwright/test";

const PROFILES_SEARCH_REGEX = /\/api\/profiles\/search/;

test.describe("Search Suggestions", () => {
  test.beforeEach(async ({ page }) => {
    page.on("request", (req) => console.log("REQ:", req.url()));
    page.on("response", (res) => console.log("RES:", res.url(), res.status()));
    await page.addInitScript(() => {
      window.localStorage.setItem("linkora_guided_tour_dismissed", "true");
    });
    // Mock search APIs specifically
    await page.route(PROFILES_SEARCH_REGEX, async (route) => {
      const urlObj = new URL(route.request().url());
      const query = urlObj.searchParams.get("q") || "";

      if (query.toLowerCase().includes("slow")) {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ profiles: [] }),
        });
        return;
      }

      if (query.toLowerCase().includes("alice") || query.toLowerCase().includes("ali")) {
        await route.fulfill({
          status: 200,
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
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profiles: [] }),
      });
    });

    await page.route(/\/api\/search(\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
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
    await page.evaluate(() => {
      localStorage.setItem("linkora_recent_searches", JSON.stringify(["test query"]));
    });
    await page.reload();

    const searchBox = page.getByRole("search").first().locator("input");

    // Focus the search bar without typing
    await searchBox.focus();

    // Should show recent searches dropdown
    await expect(page.getByText("Recent Searches")).toBeVisible();
    await expect(page.getByText("test query")).toBeVisible();
  });

  test("shows profile suggestions as user types", async ({ page }) => {
    const searchBox = page.getByRole("search").first().locator("input");

    // Type to trigger suggestions
    await searchBox.focus();
    await searchBox.fill("ali");

    // Wait for debounce and API call
    await page.waitForTimeout(400);

    // Should show profile suggestions
    const suggestions = page.locator("#search-suggestions");
    await expect(suggestions.filter({ hasText: "Alice Wonder" })).toBeVisible();
    await expect(suggestions.filter({ hasText: "Alice Developer" })).toBeVisible();
    await expect(page.getByText("Profile").first()).toBeVisible();
  });

  test("highlights matching text in suggestions", async ({ page }) => {
    const searchBox = page.getByRole("search").first().locator("input");

    await searchBox.focus();
    await searchBox.fill("alice");
    await page.waitForTimeout(400);

    // Check for highlighted text
    const suggestions = page.locator("#search-suggestions");
    await expect(suggestions.locator("mark").first()).toBeVisible();
  });

  test("can click on a suggestion to perform search", async ({ page }) => {
    const searchBox = page.getByRole("search").first().locator("input");

    await searchBox.focus();
    await searchBox.fill("ali");
    await page.waitForTimeout(400);

    // Click on the first suggestion
    await page
      .locator('#search-suggestions [role="option"]')
      .filter({ hasText: "Alice Wonder" })
      .click();

    // Should navigate to search results
    await expect(page).toHaveURL(/\/search\?q=Alice(%20|\+)Wonder/);
  });

  test("keyboard navigation works in suggestions", async ({ page }) => {
    const searchBox = page.getByRole("search").first().locator("input");

    await searchBox.focus();
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
    const searchBox = page.getByRole("search").first().locator("input");

    await searchBox.focus();
    await searchBox.fill("ali");
    await page.waitForTimeout(400);

    await expect(
      page.locator("#search-suggestions").filter({ hasText: "Alice Wonder" })
    ).toBeVisible();

    // Press Escape
    await searchBox.press("Escape");

    // Dropdown should be hidden
    await expect(page.locator("#search-suggestions")).toBeHidden();
  });

  test("can clear recent searches", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem("linkora_recent_searches", JSON.stringify(["test 2", "test 1"]));
    });
    await page.reload();

    const searchBox = page.getByRole("search").first().locator("input");

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
    await page.evaluate(() => {
      localStorage.setItem("linkora_recent_searches", JSON.stringify(["test 2", "test 1"]));
    });
    await page.reload();

    const searchBox = page.getByRole("search").first().locator("input");

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
    const searchBox = page.getByRole("search").first().locator("input");

    await searchBox.focus();
    await searchBox.fill("#stellar");
    await page.waitForTimeout(400);

    // Should show hashtag suggestion
    await expect(page.getByText("#stellar").first()).toBeVisible();
    await expect(page.getByText("Hashtag")).toBeVisible();
  });

  test("shows loading indicator while fetching suggestions", async ({ page }) => {
    const searchBox = page.getByRole("search").first().locator("input");
    await searchBox.focus();
    await searchBox.fill("slow");
    await expect(page.getByText("Loading suggestions...")).toBeVisible();
  });

  test("clicking outside closes the dropdown", async ({ page }) => {
    const searchBox = page.getByRole("search").first().locator("input");

    await searchBox.focus();
    await searchBox.fill("ali");
    await page.waitForTimeout(400);

    await expect(
      page.locator("#search-suggestions").filter({ hasText: "Alice Wonder" })
    ).toBeVisible();

    // Click outside
    await page.locator("body").click({ position: { x: 10, y: 10 } });

    // Dropdown should close
    await expect(page.locator("#search-suggestions")).toBeHidden();
  });

  test("stores last 10 searches in localStorage", async ({ page }) => {
    await page.evaluate(() => {
      const items = Array.from({ length: 12 }, (_, i) => `test ${12 - i}`);
      localStorage.setItem("linkora_recent_searches", JSON.stringify(items.slice(0, 10)));
    });
    await page.reload();

    const searchBox = page.getByRole("search").first().locator("input");

    // Focus to show recent searches
    await searchBox.focus();

    // Should only show last 10
    await expect(page.getByText("test 12", { exact: true })).toBeVisible();
    await expect(page.getByText("test 3", { exact: true })).toBeVisible();
    await expect(page.getByText("test 2", { exact: true })).toBeHidden();
    await expect(page.getByText("test 1", { exact: true })).toBeHidden();
  });

  test("recent searches persist across page reloads", async ({ page }) => {
    const searchBox = page.getByRole("search").first().locator("input");
    const searchButton = page.getByRole("search").first().getByRole("button", { name: "Search" });

    // Perform a search
    await searchBox.focus();
    await searchBox.fill("persistent search");
    await searchButton.click();

    // Reload the page
    await page.reload();

    // Focus search bar
    const reloadedSearchBox = page.getByRole("search").first().locator("input");
    await reloadedSearchBox.focus();

    // Recent search should still be there
    await expect(page.getByText("persistent search")).toBeVisible();
  });
});

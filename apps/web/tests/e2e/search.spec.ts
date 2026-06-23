import { expect, test } from "@playwright/test";

test("search renders post and profile results from the NavBar", async ({ page }) => {
  await page.route("**/api/search?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        posts: [
          {
            id: "old-post",
            author: "GALICE1234567890",
            content: "A stellar builders update from last month.",
            tip_total: 2,
            timestamp: 1_735_689_600,
          },
          {
            id: "new-post",
            author: "GBOB1234567890",
            content: "Fresh Stellar launch notes.",
            tip_total: 50,
            timestamp: 1_738_368_000,
          },
        ],
      }),
    });
  });

  await page.route("**/api/profiles/search?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profiles: [
          {
            address: "GSTELLARPROFILE1234567890",
            username: "stellar_alice",
            followerCount: 12,
          },
        ],
      }),
    });
  });

  await page.goto("/");

  await page.getByRole("search").first().getByRole("textbox").fill("stellar");
  await page.getByRole("search").first().getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/search\?q=stellar/);
  await expect(page.getByText("A stellar builders update from last month.")).toBeVisible();
  await expect(page.locator("mark").filter({ hasText: /stellar/i }).first()).toBeVisible();

  await page.getByLabel("Sort").selectOption("most_tipped");
  await expect(page).toHaveURL(/sort=most_tipped/);
  await expect(page.locator("article").first()).toContainText("Fresh Stellar launch notes.");

  await page.getByLabel("From").fill("2025-01-01");
  await expect(page).toHaveURL(/from=2025-01-01/);
  await expect(page.getByText("A stellar builders update from last month.")).toBeHidden();

  await page.getByRole("button", { name: "Profiles" }).click();
  await expect(page).toHaveURL(/tab=profiles/);
  await expect(page.getByText("stellar_alice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow" })).toBeVisible();
});

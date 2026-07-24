import { expect, test } from "@playwright/test";

test("search renders post and profile results from the NavBar", async ({ page }) => {
  page.on("request", (req) => console.log("REQ:", req.url()));
  page.on("response", (res) => console.log("RES:", res.url(), res.status()));
  await page.addInitScript(() => {
    window.localStorage.setItem("linkora_guided_tour_dismissed", "true");
  });
  await page.route(/.*/, async (route) => {
    const url = route.request().url();
    if (url.includes("/api/")) console.log("MATCHED API URL:", url);
    if (url.includes("/api/profiles/search")) {
      await route.fulfill({
        status: 200,
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
      return;
    }

    if (url.includes("/api/search") && !url.includes("/api/profiles/search")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          posts: [
            {
              id: "old-post",
              author: "GALICE1234567890",
              content: "A stellar builders update from last month.",
              tip_total: 2,
              timestamp: 1_733_011_200,
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
      return;
    }

    await route.continue();
  });

  await page.goto("/");

  const searchInput = page.getByRole("search").first().locator("input");
  await searchInput.focus();
  await searchInput.fill("stellar");
  await page.getByRole("search").first().getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/search\?q=stellar/);
  await expect(page.locator("article").first()).toContainText(
    "A stellar builders update from last month."
  );
  await expect(
    page
      .locator("mark")
      .filter({ hasText: /stellar/i })
      .first()
  ).toBeVisible();

  await page.getByLabel("Sort").selectOption("most_tipped");
  await expect(page).toHaveURL(/sort=most_tipped/);
  await expect(page.locator("article").first()).toContainText("Fresh Stellar launch notes.");

  await page.getByLabel("From").fill("2025-01-01");
  await expect(page).toHaveURL(/from=2025-01-01/);
  await expect(page.locator("article")).not.toContainText(
    "A stellar builders update from last month."
  );

  await page.getByRole("button", { name: "Profiles" }).click();
  await expect(page).toHaveURL(/tab=profiles/);
  await expect(page.getByText("stellar_alice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow" })).toBeVisible();
});

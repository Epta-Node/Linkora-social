import { test, expect } from "@playwright/test";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

test.describe("Profile page", () => {
  test("shows handle and follower count", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes(`/api/profiles/${ADDRESS}`) || url.includes("/api/profile")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            address: ADDRESS,
            username: "alice",
            follower_count: 12,
            following_count: 3,
          }),
        });
        return;
      }
      if (url.includes("/followers")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ followers: [], total: 12, has_more: false, next_cursor: null }),
        });
        return;
      }
      if (url.includes("/following")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ following: [], total: 3, has_more: false, next_cursor: null }),
        });
        return;
      }
      if (url.includes("/posts")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ posts: [], has_more: false, next_cursor: null }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto(`/profile/${ADDRESS}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("#profile-username")).toBeVisible();
    await expect(page.locator("#followers-count")).toBeVisible();
  });
});

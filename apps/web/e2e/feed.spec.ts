import { test, expect } from "@playwright/test";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

test.describe("Feed", () => {
  test("renders at least one post skeleton after connecting mock wallet", async ({ page }) => {
    await page.addInitScript((address) => {
      window.localStorage.setItem("linkora_wallet_public_key", address);
      window.localStorage.setItem("linkora_wallet_address", address);
      (window as any).freighterApi = {
        getPublicKey: () => Promise.resolve(address),
        isConnected: () => Promise.resolve(true),
      };
    }, ADDRESS);

    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/posts") || url.includes("/feed") || url.includes("/api/search")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            posts: [],
            has_more: false,
            next_cursor: null,
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/feed");
    await page.waitForLoadState("domcontentloaded");

    const connectButton = page.locator('[data-testid="connect-wallet"]').first();
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
    }

    await expect(page.locator('[data-testid="wallet-address"]').first()).toBeVisible();
    const skeleton = page.locator('[data-testid="post-card-skeleton"]').first();
    await expect(skeleton).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

test.describe("Post composer", () => {
  test("publishes a post and shows success state", async ({ page }) => {
    await page.addInitScript((address) => {
      window.localStorage.setItem("linkora_wallet_public_key", address);
      window.localStorage.setItem("linkora_wallet_address", address);
      (window as any).freighterApi = {
        getPublicKey: () => Promise.resolve(address),
        isConnected: () => Promise.resolve(true),
      };
    }, ADDRESS);

    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.includes("/api/posts") && req.method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: "1", content: "Hello from e2e", author: ADDRESS }),
        });
        return;
      }
      if (url.includes("/api/posts") || url.includes("/feed")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ posts: [], has_more: false, next_cursor: null }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/feed");
    await page.waitForLoadState("domcontentloaded");

    const compose = page.getByRole("button", { name: /compose/i }).first();
    await expect(compose).toBeVisible();
    await compose.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("What's happening?").fill("Hello from e2e");
    await dialog.getByRole("button", { name: /^post$/i }).click();

    await expect(dialog.getByText(/post/i).first()).toBeVisible();
  });
});

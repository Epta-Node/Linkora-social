import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("loads and shows Connect Wallet button", async ({ page }) => {
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.resourceType() === "document" || request.url().includes("127.0.0.1:3000")) {
        return route.continue();
      }
      return route.continue();
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    const connectWallet = page.getByRole("button", { name: /connect/i }).first();
    await expect(connectWallet).toBeVisible();
    await expect(page.getByText(/connect wallet|connect/i).first()).toBeVisible();
  });
});

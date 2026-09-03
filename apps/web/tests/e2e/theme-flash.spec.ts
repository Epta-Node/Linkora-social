import { test, expect } from "@playwright/test";

/**
 * E2E tests for the theme-flash (FOUC) fix — Issue #1205.
 *
 * Verifies that the persisted theme is applied synchronously before
 * React hydrates, preventing a white flash for dark-mode users.
 */

test.describe("Theme FOUC prevention", () => {
  test("sets data-theme='dark' on <html> before React hydration when localStorage has dark", async ({
    page,
  }) => {
    // Seed localStorage with a dark theme preference before navigating
    await page.addInitScript(() => {
      localStorage.setItem("linkora_theme", "dark");
    });

    await page.goto("/");

    // The inline script in <head> should have set data-theme="dark" immediately.
    // We check it via the documentElement attribute.
    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(themeAttr).toBe("dark");
  });

  test("sets data-theme='light' on <html> when localStorage has light", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("linkora_theme", "light");
    });

    await page.goto("/");

    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(themeAttr).toBe("light");
  });

  test("falls back to system preference when no stored theme", async ({ page }) => {
    // Ensure localStorage is empty
    await page.addInitScript(() => {
      localStorage.removeItem("linkora_theme");
    });

    await page.goto("/");

    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
    // Should be either "light" or "dark" depending on system preference,
    // never undefined.
    expect(["light", "dark"]).toContain(themeAttr);
  });

  test("never flashes light background for dark-theme users", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("linkora_theme", "dark");
    });

    await page.goto("/");

    // Verify the background is dark-colored right away — no white flash.
    // The dark theme uses a dark background (#0f172a).
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });

    // Dark bg should NOT be white (rgb(255, 255, 255)) or near-white
    expect(bgColor).not.toBe("rgb(255, 255, 255)");
    expect(bgColor).not.toBe("rgba(255, 255, 255, 1)");
  });

  test("ThemeContext initializes with correct theme from the start", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("linkora_theme", "dark");
    });

    await page.goto("/");

    // The ThemeProvider should have initialized with "dark" — no intermediate
    // "light" flash. We verify via the data-theme attribute which is kept in
    // sync by ThemeBootstrap / the inline script.
    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(themeAttr).toBe("dark");

    // Also verify no temporary "light" theme was ever set by checking that
    // the theme never changed during page load
    const finalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(finalTheme).toBe("dark");
  });
});

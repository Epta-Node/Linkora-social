import { test, expect } from "@playwright/test";

test.describe("Dashboard responsive layout", () => {
  test("shows both sidebars on desktop (>= 1024px) and hides mobile menu button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("dashboard-left-sidebar")).toBeVisible();
    await expect(page.getByTestId("dashboard-right-sidebar")).toBeVisible();
    await expect(page.getByTestId("dashboard-mobile-menu-button")).toBeHidden();
  });

  test("collapses the right sidebar below 1024px while keeping the left sidebar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("dashboard-right-sidebar")).toBeHidden();
    await expect(page.getByTestId("dashboard-left-sidebar")).toBeVisible();
    await expect(page.getByTestId("dashboard-mobile-menu-button")).toBeHidden();
  });

  test("collapses left sidebar into hamburger menu and shows single-column grid below 768px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("dashboard-right-sidebar")).toBeHidden();

    const menuButton = page.getByTestId("dashboard-mobile-menu-button");
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("dashboard-left-sidebar")).toHaveClass(/is-mobile-open/);

    await page.getByTestId("dashboard-sidebar-backdrop").click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("dashboard-left-sidebar")).not.toHaveClass(/is-mobile-open/);

    const columnCount = await page
      .locator(".dashboard-masonry-grid")
      .first()
      .evaluate((el) => window.getComputedStyle(el).columnCount);
    expect(columnCount).toBe("1");
  });
});

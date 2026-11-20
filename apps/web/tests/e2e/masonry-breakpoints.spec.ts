import { test, expect } from "@playwright/test";

const cases = [
  { name: "mobile", width: 375, columns: "1" },
  { name: "tablet", width: 768, columns: "2" },
  { name: "small desktop", width: 1023, columns: "2" },
  { name: "desktop", width: 1024, columns: "3" },
  { name: "wide desktop", width: 1440, columns: "3" },
];

test.describe("Masonry grid breakpoints", () => {
  for (const { name, width, columns } of cases) {
    test(`uses ${columns} column(s) on ${name} (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/demo/masonry");
      const grid = page.getByTestId("masonry-grid");
      await expect(grid).toBeVisible();
      await expect
        .poll(() => grid.evaluate((el) => getComputedStyle(el).columnCount))
        .toBe(columns);
    });
  }
});

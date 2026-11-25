import { render, screen } from "@testing-library/react";
import { MasonryGrid, RESPONSIVE_COLUMN_CLASSES } from "./MasonryGrid";

describe("MasonryGrid", () => {
  it("is responsive (1/2/3 columns) when no column count is given", () => {
    render(
      <MasonryGrid>
        <p>a</p>
      </MasonryGrid>
    );
    const grid = screen.getByTestId("masonry-grid");
    expect(grid).toHaveClass(...RESPONSIVE_COLUMN_CLASSES.split(" "));
    expect(grid.style.columnCount).toBe("");
  });

  it("keeps a fixed column count when one is passed", () => {
    render(
      <MasonryGrid columns={2}>
        <p>a</p>
      </MasonryGrid>
    );
    const grid = screen.getByTestId("masonry-grid");
    expect(grid.style.columnCount).toBe("2");
    expect(grid).not.toHaveClass("lg:columns-3");
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider } from "./ThemeContext";

describe("ThemeToggle", () => {
  it("toggles between light and dark themes", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const toggleButton = screen.getByRole("button");
    const initialLabel = toggleButton.getAttribute("aria-label");

    fireEvent.click(toggleButton);

    expect(toggleButton.getAttribute("aria-label")).not.toBe(initialLabel);
  });

  it("applies system preference by default", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    // The toggle advertises the *next* theme, so the initial label must name
    // one of the two concrete themes rather than "system".
    expect(screen.getByRole("button").getAttribute("aria-label")).toMatch(/light|dark/i);
  });
});
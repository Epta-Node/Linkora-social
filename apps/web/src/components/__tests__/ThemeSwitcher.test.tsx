import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

function renderSwitcher() {
  return render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
});

describe("ThemeSwitcher", () => {
  it("opens a menu with Light, Dark and System options", () => {
    renderSwitcher();

    fireEvent.click(screen.getByTestId("theme-switcher"));

    expect(screen.getByRole("menu", { name: "Choose theme" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "System" })).toBeInTheDocument();
  });

  it("applies and persists the selected theme", () => {
    renderSwitcher();

    fireEvent.click(screen.getByTestId("theme-switcher"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));

    expect(localStorage.getItem("linkora_theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.queryByTestId("theme-switcher-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("theme-switcher")).toHaveAttribute(
      "aria-label",
      "Theme: Dark. Change theme"
    );
  });

  it("marks the active preference as checked", () => {
    localStorage.setItem("linkora_theme", "system");
    renderSwitcher();

    fireEvent.click(screen.getByTestId("theme-switcher"));

    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("closes the menu on Escape", () => {
    renderSwitcher();

    fireEvent.click(screen.getByTestId("theme-switcher"));
    expect(screen.getByTestId("theme-switcher-menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("theme-switcher-menu")).not.toBeInTheDocument();
  });
});

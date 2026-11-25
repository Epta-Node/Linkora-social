import { fireEvent, render, screen, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";

function Probe() {
  const { preference, theme, setTheme, toggleTheme } = useTheme();

  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setTheme("system")}>
        use system
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        use dark
      </button>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
  (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

describe("ThemeProvider", () => {
  it("defaults to the system preference when nothing is stored", () => {
    renderProbe();

    expect(screen.getByTestId("preference")).toHaveTextContent("system");
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.themePreference).toBe("system");
  });

  it("persists an explicit theme and applies it to the document", () => {
    renderProbe();

    fireEvent.click(screen.getByRole("button", { name: "use dark" }));

    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(localStorage.getItem("linkora_theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
  });

  it("restores the stored preference on mount", () => {
    localStorage.setItem("linkora_theme", "dark");

    renderProbe();

    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("resolves 'system' using prefers-color-scheme", () => {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: query.includes("dark"),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    renderProbe();

    expect(screen.getByTestId("preference")).toHaveTextContent("system");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggleTheme switches between light and dark explicitly", () => {
    renderProbe();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByTestId("preference")).toHaveTextContent("light");
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("follows OS changes while preferring 'system'", () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn((_event: string, callback: () => void) => {
        listener = callback;
      }),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    (window.matchMedia as jest.Mock).mockReturnValue(media);

    renderProbe();

    expect(screen.getByTestId("theme")).toHaveTextContent("light");

    act(() => {
      media.matches = true;
      listener?.();
    });

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

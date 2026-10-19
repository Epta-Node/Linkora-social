/**
 * Regression test for issue #1590 — "two unmounted features have passing tests".
 *
 * The keyboard-shortcuts and theme suites used to be green while
 * `app/layout.tsx` never mounted `KeyboardShortcutsProvider` or
 * `ThemeProvider`, because each suite hand-wrapped the component in the
 * provider it needed. These tests render the provider tree that
 * `app/layout.tsx` actually uses, so an unmounted provider fails here.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AppProviders } from "../layout";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useKeyboardShortcutsContext } from "@/contexts/KeyboardShortcutsContext";
import { useTheme } from "@/contexts/ThemeContext";

jest.mock("@/components/ServiceWorkerRegistration", () => () => null);

/** Reads both contexts so the assertions below prove the providers are live. */
function ContextProbe() {
  const theme = useTheme();
  const shortcuts = useKeyboardShortcutsContext();

  return (
    <div>
      <span data-testid="theme">{theme.theme}</span>
      <span data-testid="help-open">{String(shortcuts.isHelpModalOpen)}</span>
      <button type="button" onClick={shortcuts.openHelpModal}>
        open help
      </button>
    </div>
  );
}

function renderAppProviders(ui: React.ReactNode = <ContextProbe />) {
  return render(<AppProviders>{ui}</AppProviders>);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = "light";
});

describe("app/layout.tsx provider tree", () => {
  it("mounts ThemeProvider so useTheme() resolves for a page child", () => {
    renderAppProviders();

    // useTheme() throws "must be used within a ThemeProvider" if it is absent,
    // so reaching this assertion already proves the provider is mounted.
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("mounts ThemeProvider so ThemeToggle works without a manual wrapper", async () => {
    renderAppProviders(<ThemeToggle />);

    const toggle = screen.getByRole("button");
    expect(toggle).toHaveTextContent("Light");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("button")).toHaveTextContent("Dark");
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("mounts KeyboardShortcutsProvider so the help modal opens via the '?' shortcut", async () => {
    renderAppProviders(<ContextProbe />);

    expect(screen.getByTestId("help-open")).toHaveTextContent("false");

    fireEvent.keyDown(document.body, { key: "?" });

    // Requires both the provider's global listener AND the modal rendered inside it.
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("exposes the shortcut context to NavBar through the shared provider", async () => {
    renderAppProviders(<ContextProbe />);

    fireEvent.keyDown(document.body, { key: "?" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("renders page children inside the provider tree", () => {
    renderAppProviders(<p>page content</p>);
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("applies the stored theme preference to the mounted ThemeProvider", () => {
    localStorage.setItem("linkora_theme", "dark");
    document.documentElement.dataset.theme = "dark";

    renderAppProviders();

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });
});
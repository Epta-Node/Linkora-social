import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcutsContext,
} from "./KeyboardShortcutsContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
);

describe("useKeyboardShortcutsContext", () => {
  it("exposes the shortcut registration API", () => {
    const { result } = renderHook(() => useKeyboardShortcutsContext(), { wrapper });
    expect(result.current).toBeDefined();
    expect(result.current.registerComposeHandler).toBeInstanceOf(Function);
  });

  it("opens and closes the command palette", () => {
    const { result } = renderHook(() => useKeyboardShortcutsContext(), { wrapper });

    expect(result.current.isCommandPaletteOpen).toBe(false);

    act(() => result.current.openCommandPalette());
    expect(result.current.isCommandPaletteOpen).toBe(true);

    act(() => result.current.closeCommandPalette());
    expect(result.current.isCommandPaletteOpen).toBe(false);
  });
});
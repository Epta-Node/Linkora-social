"use client";

import { useEffect } from "react";

export const THEME_STORAGE_KEY = "linkora_theme";
export const THEMES = ["light", "dark", "system"] as const;

/** The preference the user picked, including "system". */
export type ThemePreference = (typeof THEMES)[number];
/** The concrete theme that ends up on the page. */
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

/**
 * Mirrors `preference` and `theme` onto <html> so CSS can respond to either:
 * `data-theme` is always the resolved light/dark value and
 * `data-theme-preference` keeps the user's choice (used by the switcher).
 */
export function applyThemePreference(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
}

export function getStoredThemePreference(): ThemePreference {
  // Called during SSR by ThemeProvider's initial reducer state; `localStorage`
  // does not exist on the server.
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

export function storeThemePreference(preference: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyThemePreference(preference);
}

export function ThemeBootstrap() {
  useEffect(() => {
    // The inline script in layout.tsx has already painted the correct theme;
    // this keeps the DOM in sync if that script was skipped or storage changed.
    applyThemePreference(getStoredThemePreference());
  }, []);

  return null;
}

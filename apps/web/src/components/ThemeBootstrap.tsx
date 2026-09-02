"use client";

import { useEffect } from "react";

const THEME_STORAGE_KEY = "linkora_theme";
const THEMES = ["light", "dark"] as const;

type ThemePreference = (typeof THEMES)[number];

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark";
}

export function applyThemePreference(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
}

export function getStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (isThemePreference(stored)) return stored;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function storeThemePreference(theme: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyThemePreference(theme);
}

export function ThemeBootstrap() {
  useEffect(() => {
    // Only apply if the inline script in layout.tsx hasn't already set it
    if (!document.documentElement.dataset.theme) {
      applyThemePreference(getStoredThemePreference());
    }
  }, []);

  return null;
}

export { THEME_STORAGE_KEY };
export type { ThemePreference };

"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  applyThemePreference,
  getStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "../components/ThemeBootstrap";

interface ThemeContextType {
  /** Resolved theme currently painted on the page ("light" or "dark"). */
  theme: ResolvedTheme;
  /** What the user chose: "light", "dark", or "system". */
  preference: ThemePreference;
  toggleTheme: () => void;
  setTheme: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getStoredThemePreference);
  const [theme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getStoredThemePreference())
  );

  const setTheme = useCallback((nextPreference: ThemePreference) => {
    setPreference(nextPreference);
    setResolvedTheme(resolveTheme(nextPreference));
    storeThemePreference(nextPreference);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  // Keep the page in sync if the inline bootstrap script did not run (or ran
  // before a test reset the DOM).
  useEffect(() => {
    applyThemePreference(preference);
    setResolvedTheme(resolveTheme(preference));
  }, [preference]);

  // In "system" mode, follow the OS preference live.
  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const nextTheme: ResolvedTheme = media.matches ? "dark" : "light";
      setResolvedTheme(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    // Safari < 14
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [preference]);

  return (
    <ThemeContext.Provider value={{ theme, preference, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

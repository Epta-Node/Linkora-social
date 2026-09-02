"use client";

import { createContext, useContext, useState } from "react";
import {
  getStoredThemePreference,
  storeThemePreference,
  ThemePreference,
} from "../components/ThemeBootstrap";

interface ThemeContextType {
  theme: ThemePreference;
  toggleTheme: () => void;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getInitialTheme(): ThemePreference {
  // Try to read from the DOM first (set by the inline script in layout.tsx)
  if (typeof document !== "undefined") {
    const domTheme = document.documentElement.dataset.theme;
    if (domTheme === "light" || domTheme === "dark") return domTheme;
  }
  return getStoredThemePreference();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(getInitialTheme);

  const setTheme = (newTheme: ThemePreference) => {
    setThemeState(newTheme);
    storeThemePreference(newTheme);
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
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

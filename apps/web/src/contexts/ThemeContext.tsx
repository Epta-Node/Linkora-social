"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("dark");

  useEffect(() => {
    const active = getStoredThemePreference();
    setThemeState(active);
  }, []);

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

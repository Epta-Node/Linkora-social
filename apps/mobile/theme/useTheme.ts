import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, createElement, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { themes, type ColorScheme, type ThemeTokens } from "./tokens";

export interface UseThemeResult {
  colorScheme: ColorScheme;
  isDark: boolean;
  theme: ThemeTokens;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export type ThemePreference = ColorScheme | "system";
const THEME_PREFERENCE_KEY = "linkora.theme.preference";
const ThemeContext = createContext<{ preference: ThemePreference; setPreference: (value: ThemePreference) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  useEffect(() => {
    AsyncStorage.getItem(THEME_PREFERENCE_KEY).then((value) => {
      if (value === "light" || value === "dark" || value === "system") setPreferenceState(value);
    });
  }, []);
  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    void AsyncStorage.setItem(THEME_PREFERENCE_KEY, value);
  }, []);
  return createElement(ThemeContext.Provider, { value: { preference, setPreference } }, children);
}

export function useTheme(): UseThemeResult {
  const systemScheme = useColorScheme();
  const context = useContext(ThemeContext);
  const preference = context?.preference ?? "system";

  return useMemo(() => {
    const colorScheme: ColorScheme = preference === "system" ? (systemScheme === "light" ? "light" : "dark") : preference;
    return {
      colorScheme,
      isDark: colorScheme === "dark",
      theme: themes[colorScheme],
      preference,
      setPreference: context?.setPreference ?? (() => undefined),
    };
  }, [context?.setPreference, preference, systemScheme]);
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemePreference must be used inside ThemeProvider");
  return context;
}

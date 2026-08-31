import { useColorScheme } from "react-native";
import { useMemo } from "react";

import { themes, type ColorScheme, type ThemeTokens } from "./tokens";

export interface UseThemeResult {
  colorScheme: ColorScheme;
  isDark: boolean;
  theme: ThemeTokens;
}

export function useTheme(): UseThemeResult {
  const systemScheme = useColorScheme();

  return useMemo(() => {
    const colorScheme: ColorScheme = systemScheme === "light" ? "light" : "dark";
    return {
      colorScheme,
      isDark: colorScheme === "dark",
      theme: themes[colorScheme],
    };
  }, [systemScheme]);
}

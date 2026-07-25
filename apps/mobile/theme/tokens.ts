export type ColorScheme = "light" | "dark";

export type ThemeTokens = {
  scheme: ColorScheme;
  colors: {
    brand: {
      primary: string;
      primaryHover: string;
      primaryLight: string;
      secondary: string;
      secondaryHover: string;
      secondaryLight: string;
      accent: string;
      accentHover: string;
    };
    semantic: {
      success: string;
      successLight: string;
      warning: string;
      warningLight: string;
      error: string;
      errorLight: string;
      info: string;
      infoLight: string;
    };
    surface: {
      background: string;
      surface1: string;
      surface2: string;
      border: string;
      borderStrong: string;
    };
    text: {
      primary: string;
      secondary: string;
      disabled: string;
      inverse: string;
      onBrand: string;
    };
    overlay: {
      scrim: string;
    };
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    "2xl": number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
};

const brand = {
  primary: "#7C3AED",
  primaryHover: "#6D28D9",
  primaryLight: "#EDE9FE",
  secondary: "#06B6D4",
  secondaryHover: "#0891B2",
  secondaryLight: "#CFFAFE",
  accent: "#F59E0B",
  accentHover: "#D97706",
};

const semantic = {
  success: "#10B981",
  successLight: "#D1FAE5",
  warning: "#F59E0B",
  warningLight: "#FEF3C7",
  error: "#EF4444",
  errorLight: "#FEE2E2",
  info: "#3B82F6",
  infoLight: "#DBEAFE",
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 40,
};

const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

const lightColors = {
  brand,
  semantic,
  surface: {
    background: "#FFFFFF",
    surface1: "#F9FAFB",
    surface2: "#F3F4F6",
    border: "#E5E7EB",
    borderStrong: "#D1D5DB",
  },
  text: {
    primary: "#111827",
    secondary: "#6B7280",
    disabled: "#9CA3AF",
    inverse: "#FFFFFF",
    onBrand: "#FFFFFF",
  },
  overlay: {
    scrim: "rgba(17, 24, 39, 0.28)",
  },
};

const darkColors = {
  brand,
  semantic,
  surface: {
    background: "#0F172A",
    surface1: "#1E293B",
    surface2: "#334155",
    border: "#334155",
    borderStrong: "#475569",
  },
  text: {
    primary: "#F9FAFB",
    secondary: "#9CA3AF",
    disabled: "#4B5563",
    inverse: "#111827",
    onBrand: "#FFFFFF",
  },
  overlay: {
    scrim: "rgba(15, 23, 42, 0.72)",
  },
};

export const themes: Record<ColorScheme, ThemeTokens> = {
  light: {
    scheme: "light",
    colors: lightColors,
    spacing,
    radius,
  },
  dark: {
    scheme: "dark",
    colors: darkColors,
    spacing,
    radius,
  },
};

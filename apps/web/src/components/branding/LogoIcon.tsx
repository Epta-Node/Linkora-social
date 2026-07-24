import React from "react";
import { LOGO_COLORS } from "@/lib/constants";

export interface LogoIconProps {
  size?: "sm" | "md" | "lg" | "xl" | number;
  className?: string;
  variant?: "gradient" | "white" | "mono";
  animated?: boolean;
}

const sizeMap = {
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
};

export const LogoIcon: React.FC<LogoIconProps> = ({
  size = "md",
  className = "",
  variant = "gradient",
  animated = false,
}) => {
  const pixelSize = typeof size === "number" ? size : sizeMap[size] || 32;

  const getGradientFill = () => {
    if (variant === "white") return "#FFFFFF";
    if (variant === "mono") return "currentColor";
    return "url(#stellar-grad-icon)";
  };

  const getInnerFill = () => {
    if (variant === "white") return "#0F172A";
    if (variant === "mono") return "none";
    return "#1E3A5F";
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={pixelSize}
      height={pixelSize}
      fill="none"
      className={`${animated ? "logo-animated" : ""} ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="stellar-grad-icon" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={LOGO_COLORS.deepSpaceBlue} />
          <stop offset="100%" stopColor={LOGO_COLORS.stellarPurple} />
        </linearGradient>
        <filter id="glow-icon" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#6366F1" floodOpacity="0.3" />
        </filter>
      </defs>

      {variant === "gradient" && (
        <g opacity="0.85">
          <circle cx="16" cy="14" r="1" fill="#FFFFFF" opacity="0.9" />
          <circle cx="48" cy="18" r="1.2" fill="#FFFFFF" opacity="0.8" />
          <circle cx="52" cy="46" r="1" fill="#FFFFFF" opacity="0.7" />
          <path
            d="M 44 12 L 45 14 L 47 15 L 45 16 L 44 18 L 43 16 L 41 15 L 43 14 Z"
            fill="#FFFFFF"
            opacity="0.75"
          />
        </g>
      )}

      <g filter={variant === "gradient" ? "url(#glow-icon)" : undefined}>
        <rect x="12" y="8" width="20" height="38" rx="10" fill={getGradientFill()} />
        <rect
          x="17"
          y="13"
          width="10"
          height="28"
          rx="5"
          fill={getInnerFill()}
          opacity={variant === "mono" ? 0 : 0.95}
        />

        <rect x="18" y="34" width="38" height="20" rx="10" fill={getGradientFill()} />
        <rect
          x="23"
          y="39"
          width="28"
          height="10"
          rx="5"
          fill={getInnerFill()}
          opacity={variant === "mono" ? 0 : 0.95}
        />

        <path
          d="M 22 34 A 4 4 0 0 1 26 30 H 32 A 4 4 0 0 1 36 34"
          stroke={getGradientFill()}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
};

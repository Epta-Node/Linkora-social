import React from "react";
import Link from "next/link";
import { LogoIcon } from "./LogoIcon";
import "@/styles/logo.css";

export interface LogoProps {
  variant?: "full" | "icon" | "white" | "mono";
  size?: "sm" | "md" | "lg" | "xl";
  animated?: boolean;
  className?: string;
  onClick?: () => void;
  href?: string;
}

export const logoPaths = {
  icon: "M 12 8 H 32 V 46 H 12 Z M 18 34 H 56 V 54 H 18 Z",
  wordmark: "Linkora",
};

const sizeHeightMap = {
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
};

export const Logo: React.FC<LogoProps> = ({
  variant = "full",
  size = "md",
  animated = false,
  className = "",
  onClick,
  href = "/",
}) => {
  const height = sizeHeightMap[size] || 32;

  const renderContent = () => {
    if (variant === "icon") {
      return (
        <LogoIcon
          size={size}
          animated={animated}
          variant={variant === "white" ? "white" : variant === "mono" ? "mono" : "gradient"}
          className={className}
        />
      );
    }

    if (variant === "white") {
      return (
        <div
          className={`inline-flex items-center gap-2.5 ${animated ? "logo-animated" : ""} ${className}`}
        >
          <LogoIcon size={size} variant="white" />
          <span
            className="font-sans font-semibold tracking-tight text-white"
            style={{ fontSize: height * 0.75 }}
          >
            Linkora
          </span>
        </div>
      );
    }

    if (variant === "mono") {
      return (
        <div
          className={`inline-flex items-center gap-2.5 ${animated ? "logo-animated" : ""} ${className}`}
        >
          <LogoIcon size={size} variant="mono" />
          <span
            className="font-sans font-semibold tracking-tight text-current"
            style={{ fontSize: height * 0.75 }}
          >
            Linkora
          </span>
        </div>
      );
    }

    // Default: 'full' variant
    return (
      <div
        className={`inline-flex items-center gap-2.5 ${animated ? "logo-animated" : ""} ${className}`}
      >
        <LogoIcon size={size} animated={animated} />
        <span
          className="font-sans font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-[#1E3A5F] to-[#6366F1] dark:from-white dark:to-violet-200"
          style={{ fontSize: height * 0.75 }}
        >
          Linkora
        </span>
      </div>
    );
  };

  const content = renderContent();

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className="inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1] rounded-lg logo-hover-effect"
        aria-label="Linkora home"
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center ${onClick ? "cursor-pointer logo-hover-effect" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {content}
    </div>
  );
};

export default Logo;

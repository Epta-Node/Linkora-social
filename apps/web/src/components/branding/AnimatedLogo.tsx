import React from "react";
import { LogoIcon } from "./LogoIcon";

export interface AnimatedLogoProps {
  size?: "sm" | "md" | "lg" | "xl" | number;
  className?: string;
  label?: string;
  showWordmark?: boolean;
}

export const AnimatedLogo: React.FC<AnimatedLogoProps> = ({
  size = "lg",
  className = "",
  label = "Loading...",
  showWordmark = false,
}) => {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className="relative">
        <LogoIcon size={size} animated={true} />
      </div>
      {showWordmark && (
        <span className="text-sm font-semibold tracking-wide bg-gradient-to-r from-[#1E3A5F] to-[#6366F1] bg-clip-text text-transparent animate-pulse">
          Linkora
        </span>
      )}
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
};

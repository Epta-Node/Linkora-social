"use client";

import React from "react";

export interface CharacterCounterProps {
  current: number;
  max?: number;
  className?: string;
}

export function CharacterCounter({ current, max = 280, className = "" }: CharacterCounterProps) {
  const percentage = (current / max) * 100;
  const isNearLimit = percentage >= 90;
  const isOverLimit = current > max;

  return (
    <div
      className={`text-xs font-medium transition-colors ${
        isOverLimit
          ? "text-red-600 font-bold"
          : isNearLimit
            ? "text-red-500 font-semibold"
            : "text-gray-400"
      } ${className}`}
      data-testid="character-counter"
    >
      <span>
        {current} / {max}
      </span>
    </div>
  );
}

"use client";

import React from "react";
import { utf8Bytes } from "linkora-sdk";

export interface CharacterCounterProps {
  value: string;
  max?: number;
  className?: string;
}

export function CharacterCounter({ value, max = 280, className = "" }: CharacterCounterProps) {
  const current = utf8Bytes(value);
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

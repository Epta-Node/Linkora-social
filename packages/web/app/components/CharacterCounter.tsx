"use client";

// Exported CharacterCounter component for ComposeModal

interface CharacterCounterProps {
  contentLength: number;
  maxLength: number;
}

export function CharacterCounter({ contentLength, maxLength }: CharacterCounterProps) {
  const remaining = maxLength - contentLength;
  const isRed = remaining < 20;

  return (
    <span
      className="character-counter"
      style={{
        fontSize: "0.85rem",
        color: isRed ? "#ef4444" : "var(--color-text-secondary, #94a3b8)",
        fontWeight: isRed ? 600 : 400,
        transition: "color 0.2s",
      }}
      aria-live="polite"
      aria-label={`${remaining} characters remaining`}
    >
      {remaining}
    </span>
  );
}

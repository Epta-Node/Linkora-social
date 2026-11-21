"use client";

// Exported CharacterCounter component for ComposeModal

interface CharacterCounterProps {
  contentLength: number;
  maxLength: number;
}

export type CharacterCounterStatus = "ok" | "warning" | "limit";

export function getCharacterCounterStatus(
  contentLength: number,
  maxLength: number
): CharacterCounterStatus {
  if (maxLength <= 0 || contentLength >= maxLength) return "limit";
  if (contentLength >= maxLength * 0.8) return "warning";
  return "ok";
}

const STATUS_COLORS: Record<CharacterCounterStatus, string> = {
  ok: "#22c55e",
  warning: "#eab308",
  limit: "#ef4444",
};

export function CharacterCounter({ contentLength, maxLength }: CharacterCounterProps) {
  const remaining = maxLength - contentLength;
  const status = getCharacterCounterStatus(contentLength, maxLength);
  const color = STATUS_COLORS[status];

  return (
    <span
      className={`character-counter character-counter--${status}`}
      data-status={status}
      style={{
        fontSize: "0.85rem",
        color,
        fontWeight: status === "ok" ? 400 : 600,
        transition: "color 0.2s",
      }}
      aria-live="polite"
      aria-label={`${remaining} characters remaining`}
    >
      {remaining}
    </span>
  );
}

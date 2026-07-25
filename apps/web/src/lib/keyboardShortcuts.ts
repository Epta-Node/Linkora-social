/**
 * keyboardShortcuts.ts
 *
 * Single source-of-truth for all keyboard shortcut definitions.
 * Consumed by:
 *  - KeyboardShortcutsContext (the hook that handles key events)
 *  - KeyboardShortcutsModal  (the help dialog)
 *  - KeyboardShortcutsSection (the Settings section)
 */

export interface ShortcutDefinition {
  /** Ordered list of keys that must be pressed (in sequence for multi-key). */
  readonly keys: readonly string[];
  /** Human-readable description shown in the modal and settings page. */
  readonly label: string;
  /** Optional group label for visual grouping in the help modal. */
  readonly group?: string;
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  // ── Composition ──────────────────────────────────────────────────────────
  { keys: ["n"], label: "Open new post composer", group: "Actions" },
  { keys: ["/"], label: "Focus the global search bar", group: "Actions" },
  { keys: ["?"], label: "Open keyboard shortcuts help", group: "Actions" },

  // ── Navigation ───────────────────────────────────────────────────────────
  { keys: ["g", "f"], label: "Go to Feed", group: "Navigation" },
  { keys: ["g", "p"], label: "Go to Profile", group: "Navigation" },
  { keys: ["g", "s"], label: "Go to Settings", group: "Navigation" },

  // ── General ──────────────────────────────────────────────────────────────
  { keys: ["Escape"], label: "Close modal / return from view", group: "General" },
] as const;

/** Groups for ordered rendering in the help modal. */
export const SHORTCUT_GROUPS = ["Actions", "Navigation", "General"] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/**
 * Formats a key sequence for display.
 * e.g. ["g", "f"] → "g f"  |  ["Escape"] → "Esc"
 */
export function formatKeys(keys: readonly string[]): string {
  return keys.map((k) => (k === "Escape" ? "Esc" : k)).join(" then ");
}

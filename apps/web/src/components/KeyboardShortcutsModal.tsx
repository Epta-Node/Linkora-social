"use client";

/**
 * KeyboardShortcutsModal.tsx
 *
 * Help modal listing all available keyboard shortcuts.
 * Opened by pressing `?`, closed by `Esc` or clicking the backdrop.
 *
 * Accessibility:
 *  - role="dialog" + aria-modal="true"
 *  - aria-labelledby pointing at the heading
 *  - Focus moves to the close button on open
 *  - Focus is trapped inside while open (Tab cycles within the modal)
 *  - Backdrop is aria-hidden so screen readers stay within the dialog
 */

import React, { useEffect, useRef, type CSSProperties } from "react";
import { useKeyboardShortcutsContext } from "@/contexts/KeyboardShortcutsContext";
import { SHORTCUTS, SHORTCUT_GROUPS, formatKeys } from "@/lib/keyboardShortcuts";

const HEADING_ID = "kbd-modal-title";

export function KeyboardShortcutsModal() {
  const { isHelpModalOpen, closeHelpModal } = useKeyboardShortcutsContext();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Move focus to the close button when the modal opens
  useEffect(() => {
    if (isHelpModalOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isHelpModalOpen]);

  // Focus trap: keep Tab / Shift+Tab inside the modal
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeHelpModal();
      return;
    }

    if (e.key !== "Tab") return;

    const focusable = backdropRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  if (!isHelpModalOpen) return null;

  return (
    /* Full-screen backdrop */
    <div
      style={styles.backdrop}
      aria-hidden="false"
      onClick={closeHelpModal}
      data-testid="kbd-modal-backdrop"
    >
      {/* Dialog panel — stops click propagation so backdrop click works */}
      <div
        ref={backdropRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        data-testid="kbd-modal-panel"
      >
        {/* Header */}
        <div style={styles.header}>
          <h2 id={HEADING_ID} style={styles.heading}>
            Keyboard Shortcuts
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeHelpModal}
            style={styles.closeButton}
            aria-label="Close keyboard shortcuts help"
            data-testid="kbd-modal-close"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-neutral-100, #f3f4f6)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {/* × icon */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Shortcut groups */}
        <div style={styles.body}>
          {SHORTCUT_GROUPS.map((group) => {
            const groupShortcuts = SHORTCUTS.filter((s) => s.group === group);
            if (groupShortcuts.length === 0) return null;

            return (
              <div key={group} style={styles.group}>
                <p style={styles.groupLabel}>{group}</p>
                <table style={styles.table} role="table">
                  <tbody>
                    {groupShortcuts.map((shortcut) => (
                      <tr key={shortcut.keys.join("+")} style={styles.row}>
                        {/* Key badges */}
                        <td
                          style={styles.keysCell}
                          aria-label={`Keys: ${formatKeys(shortcut.keys)}`}
                        >
                          {shortcut.keys.map((key, i) => (
                            <React.Fragment key={key}>
                              {i > 0 && (
                                <span style={styles.thenSep} aria-hidden="true">
                                  then
                                </span>
                              )}
                              <kbd style={styles.kbd}>{key === "Escape" ? "Esc" : key}</kbd>
                            </React.Fragment>
                          ))}
                        </td>
                        {/* Description */}
                        <td style={styles.descCell}>{shortcut.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <p style={styles.footer}>
          Press <kbd style={{ ...styles.kbd, fontSize: "0.75rem" }}>?</kbd> to toggle this panel
        </p>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(0, 0, 0, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-lg, 24px)",
    backdropFilter: "blur(2px)",
  },
  panel: {
    background: "var(--color-bg, #ffffff)",
    border: "1px solid var(--color-border, #e5e7eb)",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "500px",
    maxHeight: "85vh",
    overflowY: "auto",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--space-lg, 24px) var(--space-lg, 24px) var(--space-md, 16px)",
    borderBottom: "1px solid var(--color-border, #e5e7eb)",
  },
  heading: {
    fontSize: "1.125rem",
    fontWeight: 700,
    color: "var(--color-text-primary, #111827)",
    margin: 0,
    letterSpacing: "-0.01em",
  },
  closeButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary, #6b7280)",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "background 0.12s",
    flexShrink: 0,
  },
  body: {
    padding: "var(--space-md, 16px) var(--space-lg, 24px)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-lg, 24px)",
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-sm, 8px)",
  },
  groupLabel: {
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--color-primary, #7c3aed)",
    margin: 0,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  row: {
    borderBottom: "1px solid var(--color-border, #e5e7eb)",
  },
  keysCell: {
    padding: "10px 0",
    width: "40%",
    whiteSpace: "nowrap",
    display: "table-cell",
    verticalAlign: "middle",
  },
  descCell: {
    padding: "10px 0 10px 12px",
    fontSize: "0.875rem",
    color: "var(--color-text-secondary, #6b7280)",
    verticalAlign: "middle",
  },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "28px",
    padding: "2px 7px",
    background: "var(--color-surface-2, #f3f4f6)",
    border: "1px solid var(--color-border-strong, #d1d5db)",
    borderRadius: "5px",
    fontSize: "0.8rem",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontWeight: 600,
    color: "var(--color-text-primary, #111827)",
    boxShadow: "0 1px 0 var(--color-border-strong, #d1d5db)",
  },
  thenSep: {
    fontSize: "0.7rem",
    color: "var(--color-text-secondary, #6b7280)",
    margin: "0 4px",
  },
  footer: {
    padding: "var(--space-md, 16px) var(--space-lg, 24px)",
    borderTop: "1px solid var(--color-border, #e5e7eb)",
    fontSize: "0.8rem",
    color: "var(--color-text-secondary, #6b7280)",
    margin: 0,
    textAlign: "center" as const,
  },
};

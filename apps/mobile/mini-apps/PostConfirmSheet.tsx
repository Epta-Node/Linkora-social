"use client";

import { useState, useCallback } from "react";

const MAX_CONTENT_LENGTH = 280;

export type PostConfirmSheetProps = {
  initialContent: string;
  onConfirm: (content: string) => void;
  onCancel: () => void;
};

export function PostConfirmSheet({
  initialContent,
  onConfirm,
  onCancel,
}: PostConfirmSheetProps) {
  const [content, setContent] = useState(initialContent);

  const charCount = content.length;
  const isOverLimit = charCount > MAX_CONTENT_LENGTH;
  const isEmpty = content.trim().length === 0;

  const handleConfirm = useCallback(() => {
    if (!isEmpty && !isOverLimit) onConfirm(content);
  }, [content, isEmpty, isOverLimit, onConfirm]);

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Confirm post">
      <div style={styles.sheet}>
        <h2 style={styles.title}>Review your post</h2>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={MAX_CONTENT_LENGTH + 50}
          style={styles.textarea}
          aria-label="Post content"
        />

        <span
          style={{ ...styles.counter, ...(isOverLimit ? styles.counterError : {}) }}
          aria-live="polite"
        >
          {charCount}/{MAX_CONTENT_LENGTH}
        </span>

        <div style={styles.actions}>
          <button onClick={onCancel} style={styles.cancelButton}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isEmpty || isOverLimit}
            style={{
              ...styles.confirmButton,
              ...((isEmpty || isOverLimit) ? styles.confirmButtonDisabled : {}),
            }}
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "flex-end",
    zIndex: 1000,
  },
  sheet: {
    width: "100%",
    background: "var(--color-bg)",
    borderRadius: "16px 16px 0 0",
    padding: "var(--spacing-lg)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-md)",
  },
  title: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 600,
  },
  textarea: {
    width: "100%",
    minHeight: "120px",
    padding: "var(--spacing-md)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "1rem",
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
  },
  counter: {
    alignSelf: "flex-end",
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
    fontFamily: "monospace",
  },
  counterError: {
    color: "var(--color-like)",
    fontWeight: 600,
  },
  actions: {
    display: "flex",
    gap: "var(--spacing-md)",
  },
  cancelButton: {
    flex: 1,
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    border: "1px solid var(--color-border)",
    background: "transparent",
    fontSize: "1rem",
    cursor: "pointer",
  },
  confirmButton: {
    flex: 1,
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    background: "var(--color-primary)",
    color: "white",
    fontWeight: 600,
    fontSize: "1rem",
    cursor: "pointer",
  },
  confirmButtonDisabled: {
    background: "var(--color-text-secondary)",
    cursor: "not-allowed",
    opacity: 0.6,
  },
};

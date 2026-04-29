"use client";

import { useState, useCallback } from "react";
import { useWallet } from "./WalletProvider";
import Link from "next/link";

const MAX_CONTENT_LENGTH = 280;
const WARNING_THRESHOLD = 260;
const TRANSACTION_FEE_ESTIMATE = "~0.00001 XLM";

type SubmitStatus = "idle" | "awaiting_signature" | "submitting" | "success" | "error";

interface CreatePostProps {
  onSuccess?: (postId: number) => void;
  compact?: boolean;
}

export function CreatePost({ onSuccess, compact = false }: CreatePostProps) {
  const { publicKey, isConnected } = useWallet();
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [postId, setPostId] = useState<number | null>(null);

  const charCount = content.length;
  const isNearLimit = charCount >= WARNING_THRESHOLD && charCount <= MAX_CONTENT_LENGTH;
  const isOverLimit = charCount > MAX_CONTENT_LENGTH;
  const isEmpty = content.trim().length === 0;
  const isDisabled = isEmpty || isOverLimit || status !== "idle";
  const progressPercent = Math.min((charCount / MAX_CONTENT_LENGTH) * 100, 100);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    if (newContent.length <= MAX_CONTENT_LENGTH) {
      setContent(newContent);
    }
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (isDisabled || !publicKey) return;

      setStatus("awaiting_signature");
      setError(null);

      try {
        // Simulate wallet signature prompt
        await new Promise((resolve) => setTimeout(resolve, 800));
        
        setStatus("submitting");
        
        // Simulate blockchain transaction
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const newPostId = Math.floor(Math.random() * 10000) + 1;
        setPostId(newPostId);
        setStatus("success");

        if (onSuccess) {
          onSuccess(newPostId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create post";
        setError(message);
        setStatus("error");
      }
    },
    [content, isDisabled, publicKey, onSuccess],
  );

  const handleCreateAnother = () => {
    setContent("");
    setStatus("idle");
    setError(null);
    setPostId(null);
  };

  if (!isConnected) {
    return (
      <div style={compact ? styles.compactContainer : styles.container}>
        <div style={styles.walletPrompt}>
          <span style={styles.walletIcon}>👛</span>
          <p style={styles.walletText}>Connect wallet to create a post</p>
        </div>
      </div>
    );
  }

  // Success state
  if (status === "success" && postId) {
    return (
      <div style={compact ? styles.compactContainer : styles.container}>
        <div style={styles.successState}>
          <div style={styles.successIcon}>✅</div>
          <p style={styles.successText}>Post published!</p>
          <div style={styles.successActions}>
            <Link href={`/posts/${postId}`} style={styles.viewPostLink}>
              View →
            </Link>
            <button onClick={handleCreateAnother} style={styles.createAnotherBtn}>
              New
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={compact ? styles.compactContainer : styles.container}>
      {/* Author info */}
      <div style={styles.authorInfo}>
        <div style={styles.avatar}>
          {publicKey ? publicKey.slice(0, 2).toUpperCase() : "??"}
        </div>
        <span style={styles.authorName}>
          {publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : "Unknown"}
        </span>
      </div>

      <div style={styles.textareaWrapper}>
        <textarea
          value={content}
          onChange={handleContentChange}
          placeholder="What's happening?"
          maxLength={MAX_CONTENT_LENGTH}
          style={{
            ...styles.textarea,
            ...(compact ? styles.compactTextarea : {}),
            ...(isOverLimit ? styles.textareaError : {}),
          }}
          disabled={status !== "idle"}
          rows={compact ? 2 : 3}
        />
        
        {/* Character counter with circular progress */}
        <div style={styles.counterContainer}>
          <div
            style={{
              ...styles.counter,
              ...(isNearLimit ? styles.counterWarning : {}),
              ...(isOverLimit ? styles.counterError : {}),
            }}
          >
            <span style={styles.counterText}>
              {charCount}<span style={styles.counterMax}>/{MAX_CONTENT_LENGTH}</span>
            </span>
            <svg style={styles.progressRing} viewBox="0 0 36 36">
              <path
                style={styles.progressRingBg}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                style={{
                  ...styles.progressRingFill,
                  strokeDasharray: `${progressPercent}, 100`,
                  stroke: isOverLimit
                    ? "var(--color-like)"
                    : isNearLimit
                    ? "#f59e0b"
                    : "var(--color-primary)",
                }}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Fee info and actions row */}
      <div style={styles.footer}>
        <div style={styles.feeInfo}>
          <span style={styles.feeIcon}>⛽</span>
          <span style={styles.feeText}>{TRANSACTION_FEE_ESTIMATE}</span>
        </div>

        {error && (
          <div style={styles.errorContainer}>
            <span style={styles.errorIcon}>⚠️</span>
            <span style={styles.errorText}>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isDisabled}
          style={{
            ...styles.submitButton,
            ...(isDisabled ? styles.submitButtonDisabled : {}),
            ...(status === "awaiting_signature" ? styles.submitButtonSigning : {}),
            ...(status === "submitting" ? styles.submitButtonSubmitting : {}),
          }}
        >
          {status === "awaiting_signature" && (
            <>
              <span style={styles.buttonSpinner}>⏳</span>
              <span>Sign...</span>
            </>
          )}
          {status === "submitting" && (
            <>
              <span style={styles.buttonSpinner}>🔄</span>
              <span>Posting...</span>
            </>
          )}
          {status === "idle" && <span>Post</span>}
        </button>
      </div>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
    maxWidth: "600px",
  },
  compactContainer: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-md)",
  },
  authorInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    marginBottom: "var(--spacing-md)",
  },
  avatar: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: "var(--color-primary)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: 600,
  },
  authorName: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--color-text)",
  },
  textareaWrapper: {
    position: "relative",
    marginBottom: "var(--spacing-md)",
  },
  textarea: {
    width: "100%",
    minHeight: "120px",
    padding: "var(--spacing-md)",
    paddingBottom: "40px",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    fontSize: "1.05rem",
    lineHeight: 1.5,
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
    background: "var(--color-bg)",
    color: "var(--color-text)",
  },
  compactTextarea: {
    minHeight: "80px",
    fontSize: "1rem",
  },
  textareaError: {
    borderColor: "var(--color-like)",
    background: "#fef2f2",
  },
  counterContainer: {
    position: "absolute",
    bottom: "var(--spacing-sm)",
    right: "var(--spacing-sm)",
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
  },
  counter: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    fontSize: "0.8rem",
    color: "var(--color-text-secondary)",
    fontFamily: "monospace",
    position: "relative",
    padding: "2px 6px 2px 24px",
    borderRadius: "6px",
    background: "var(--color-bg-secondary)",
  },
  counterWarning: {
    color: "#f59e0b",
    background: "#fffbeb",
  },
  counterError: {
    color: "var(--color-like)",
    background: "#fef2f2",
  },
  counterText: {
    fontWeight: 600,
  },
  counterMax: {
    fontWeight: 400,
    opacity: 0.7,
    fontSize: "0.75rem",
  },
  progressRing: {
    width: "18px",
    height: "18px",
    position: "absolute",
    left: "4px",
    top: "50%",
    transform: "translateY(-50%)",
  },
  progressRingBg: {
    fill: "none",
    stroke: "var(--color-border)",
    strokeWidth: 3,
  },
  progressRingFill: {
    fill: "none",
    strokeWidth: 3,
    strokeLinecap: "round",
    transition: "stroke-dasharray 0.3s ease, stroke 0.3s ease",
    transform: "rotate(-90deg)",
    transformOrigin: "50% 50%",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-md)",
    flexWrap: "wrap" as const,
  },
  feeInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    fontSize: "0.75rem",
    color: "var(--color-text-secondary)",
    marginRight: "auto",
  },
  feeIcon: {
    fontSize: "0.85rem",
  },
  feeText: {
    fontWeight: 500,
  },
  errorContainer: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    fontSize: "0.8rem",
    color: "var(--color-like)",
    background: "#fef2f2",
    padding: "var(--spacing-xs) var(--spacing-sm)",
    borderRadius: "6px",
    marginRight: "auto",
  },
  errorIcon: {
    fontSize: "0.9rem",
  },
  errorText: {
    fontWeight: 500,
  },
  submitButton: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "20px",
    fontWeight: 600,
    fontSize: "0.95rem",
    transition: "all 0.2s",
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    minWidth: "80px",
    justifyContent: "center",
  },
  submitButtonDisabled: {
    background: "var(--color-text-secondary)",
    cursor: "not-allowed",
    opacity: 0.5,
  },
  submitButtonSigning: {
    background: "#f59e0b",
  },
  submitButtonSubmitting: {
    background: "#3b82f6",
  },
  buttonSpinner: {
    fontSize: "0.9rem",
  },
  walletPrompt: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-lg)",
    textAlign: "center",
  },
  walletIcon: {
    fontSize: "2rem",
  },
  walletText: {
    color: "var(--color-text-secondary)",
    fontSize: "0.9rem",
    margin: 0,
  },
  successState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-lg)",
    textAlign: "center",
  },
  successIcon: {
    fontSize: "2.5rem",
  },
  successText: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--color-text)",
    margin: 0,
  },
  successActions: {
    display: "flex",
    gap: "var(--spacing-sm)",
    marginTop: "var(--spacing-sm)",
  },
  viewPostLink: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontSize: "0.85rem",
    fontWeight: 600,
    textDecoration: "none",
  },
  createAnotherBtn: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    color: "var(--color-text)",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};
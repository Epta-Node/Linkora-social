"use client";

import { useState, useCallback } from "react";
import { useWallet } from "./WalletProvider";
import { useRouter } from "next/navigation";

const MAX_CONTENT_LENGTH = 280;

interface CreatePostProps {
  onSuccess?: (postId: number) => void;
}

export function CreatePost({ onSuccess }: CreatePostProps) {
  const { publicKey, isConnected } = useWallet();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = content.length;
  const isOverLimit = charCount > MAX_CONTENT_LENGTH;
  const isEmpty = content.trim().length === 0;
  const isDisabled = isEmpty || isOverLimit || isSubmitting;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (isDisabled) return;

      setIsSubmitting(true);
      setError(null);

      try {
        console.log("Creating post with content:", content);
        console.log("Author public key:", publicKey);

        await new Promise((resolve) => setTimeout(resolve, 1500));

        const newPostId = Math.floor(Math.random() * 10000) + 1;

        if (onSuccess) {
          onSuccess(newPostId);
        } else {
          router.push(`/post/${newPostId}`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create post";
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [content, isDisabled, publicKey, onSuccess, router],
  );

  if (!isConnected) {
    return (
      <div style={styles.container}>
        <p style={styles.placeholder}>Connect wallet to create a post</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={styles.container}>
      <div style={styles.textareaWrapper}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's happening?"
          maxLength={MAX_CONTENT_LENGTH + 50}
          style={styles.textarea}
          disabled={isSubmitting}
        />
        <div
          style={{
            ...styles.counter,
            ...(isOverLimit ? styles.counterError : {}),
          }}
        >
          {charCount}/{MAX_CONTENT_LENGTH}
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <button
        type="submit"
        disabled={isDisabled}
        style={{
          ...styles.submitButton,
          ...(isDisabled ? styles.submitButtonDisabled : {}),
        }}
      >
        {isSubmitting ? "Posting..." : "Post"}
      </button>
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
  textareaWrapper: {
    position: "relative",
    marginBottom: "var(--spacing-md)",
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
    position: "absolute",
    bottom: "var(--spacing-sm)",
    right: "var(--spacing-sm)",
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
    fontFamily: "monospace",
  },
  counterError: {
    color: "var(--color-like)",
    fontWeight: 600,
  },
  submitButton: {
    width: "100%",
    padding: "var(--spacing-md)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "1rem",
    transition: "background 0.2s",
  },
  submitButtonDisabled: {
    background: "var(--color-text-secondary)",
    cursor: "not-allowed",
    opacity: 0.6,
  },
  error: {
    color: "var(--color-like)",
    fontSize: "0.9rem",
    marginBottom: "var(--spacing-md)",
  },
  placeholder: {
    color: "var(--color-text-secondary)",
    textAlign: "center",
    padding: "var(--spacing-lg)",
  },
};
"use client";

import { useState, useCallback } from "react";
import { useWallet } from "./WalletProvider";
import Link from "next/link";
import { RichTextComposer } from "./RichTextComposer";

const TRANSACTION_FEE_ESTIMATE = "~0.00001 XLM";

type SubmitStatus = "idle" | "awaiting_signature" | "submitting" | "success" | "error";

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface PollData {
  question: string;
  options: PollOption[];
}

export interface CreatePostPayload {
  content: string;
  author: string;
  poll?: PollData | null;
}

export interface CreatePostResult {
  id: number;
  transactionHash?: string;
  timestamp: number;
}

export async function submitPost(payload: CreatePostPayload): Promise<CreatePostResult> {
  const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001';
  const response = await fetch(`${INDEXER_API_URL}/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit post: ${response.statusText}`);
  }

  const data = await response.json();
  if (typeof data.id !== 'number' && typeof data.id !== 'string') {
    throw new Error('Invalid response from post creation API');
  }

  return {
    id: Number(data.id),
    transactionHash: data.transactionHash,
    timestamp: data.timestamp || Date.now(),
  };
}

interface CreatePostProps {
  onSuccess?: (postId: number) => void;
  compact?: boolean;
  submitFn?: (payload: CreatePostPayload) => Promise<CreatePostResult>;
}

export function CreatePost({ onSuccess, compact = false, submitFn = submitPost }: CreatePostProps) {
  const { publicKey, isConnected } = useWallet();
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [postId, setPostId] = useState<number | null>(null);

  // Mock users for mentions
  const mockUsers = [
    { id: "1", username: "alice", displayName: "Alice Johnson" },
    { id: "2", username: "bob", displayName: "Bob Smith" },
    { id: "3", username: "charlie", displayName: "Charlie Davis" },
    { id: "4", username: "diana", displayName: "Diana Prince" },
    { id: "5", username: "evan", displayName: "Evan Wright" },
  ];

  const handleSubmit = useCallback(
    async (content: string, _attachments?: File[], pollOptions?: PollOption[]) => {
      if (!publicKey) return;

      setStatus("awaiting_signature");
      setError(null);

      try {
        setStatus("submitting");

        const pollData: PollData | null = pollOptions && pollOptions.length > 0 ? {
          question: "Poll",
          options: pollOptions,
        } : null;

        const result = await submitFn({
          content,
          author: publicKey,
          poll: pollData,
        });

        setPostId(result.id);
        setStatus("success");

        if (onSuccess) {
          onSuccess(result.id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create post";
        setError(message);
        setStatus("error");
      }
    },
    [publicKey, submitFn, onSuccess]
  );

  const handleCreateAnother = () => {
    setStatus("idle");
    setError(null);
    setPostId(null);
  };

  if (!isConnected) {
    return (
      <div style={compact ? styles.compactContainer : styles.container}>
        <div style={styles.walletPrompt}>
          <span style={styles.walletIcon} aria-hidden="true">
            👛
          </span>
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
          <div style={styles.successIcon} aria-hidden="true">
            ✅
          </div>
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
    <div style={compact ? styles.compactContainer : styles.container}>
      {/* Author info */}
      <div style={styles.authorInfo}>
        <div style={styles.avatar}>{publicKey ? publicKey.slice(0, 2).toUpperCase() : "??"}</div>
        <span style={styles.authorName}>
          {publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : "Unknown"}
        </span>
      </div>

      {/* Rich Text Composer */}
      <RichTextComposer
        onSubmit={handleSubmit}
        placeholder="What's happening?"
        disabled={status !== "idle"}
        users={mockUsers}
      />

      {/* Fee info */}
      <div style={styles.footer}>
        <div style={styles.feeInfo}>
          <span style={styles.feeIcon} aria-hidden="true">
            ⛽
          </span>
          <span style={styles.feeText}>{TRANSACTION_FEE_ESTIMATE}</span>
        </div>

        {error && (
          <div style={styles.errorContainer}>
            <span style={styles.errorIcon}>⚠️</span>
            <span style={styles.errorText}>{error}</span>
          </div>
        )}
      </div>
    </div>
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

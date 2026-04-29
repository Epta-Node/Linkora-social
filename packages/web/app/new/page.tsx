"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "../components/WalletProvider";

const MAX_CONTENT_LENGTH = 280;
const WARNING_THRESHOLD = 260;
const TRANSACTION_FEE_ESTIMATE = "0.00001 XLM"; // Mock fee estimate

type SubmitStatus = "idle" | "awaiting_signature" | "submitting" | "success" | "error";

interface PublishState {
  status: SubmitStatus;
  errorMsg: string;
  postId: number | null;
}

export default function NewPostPage() {
  const { publicKey, isConnected } = useWallet();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [publishState, setPublishState] = useState<PublishState>({
    status: "idle",
    errorMsg: "",
    postId: null,
  });

  const charCount = content.length;
  const isNearLimit = charCount >= WARNING_THRESHOLD && charCount <= MAX_CONTENT_LENGTH;
  const isOverLimit = charCount > MAX_CONTENT_LENGTH;
  const isEmpty = content.trim().length === 0;
  const isDisabled = isEmpty || isOverLimit || publishState.status !== "idle";

  // Calculate progress for visual indicator
  const progressPercent = Math.min((charCount / MAX_CONTENT_LENGTH) * 100, 100);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    // Hard stop at 280 characters for paste operations
    if (newContent.length <= MAX_CONTENT_LENGTH) {
      setContent(newContent);
    }
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (isDisabled || !publicKey) return;

      setPublishState({ status: "awaiting_signature", errorMsg: "", postId: null });

      try {
        // Simulate wallet signature prompt
        await new Promise((resolve) => setTimeout(resolve, 800));

        setPublishState((prev) => ({ ...prev, status: "submitting" }));

        // Simulate blockchain transaction
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Mock successful post creation
        const newPostId = Math.floor(Math.random() * 10000) + 1;

        setPublishState({
          status: "success",
          errorMsg: "",
          postId: newPostId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to publish post";
        setPublishState({
          status: "error",
          errorMsg: message,
          postId: null,
        });
      }
    },
    [content, isDisabled, publicKey]
  );

  const handleCloseSuccess = () => {
    if (publishState.postId) {
      router.push(`/posts/${publishState.postId}`);
    }
  };

  const handleTryAgain = () => {
    setPublishState({ status: "idle", errorMsg: "", postId: null });
  };

  // Handle escape key to go back
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && publishState.status === "idle") {
        router.back();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [router, publishState.status]);

  // Wallet not connected state
  if (!isConnected && !isConnecting) {
    return (
      <main style={styles.main}>
        <div style={styles.container}>
          <div style={styles.walletRequired}>
            <div style={styles.walletIcon}>👛</div>
            <h2 style={styles.walletTitle}>Connect Your Wallet</h2>
            <p style={styles.walletText}>
              You need to connect your wallet to publish posts on-chain.
            </p>
            <Link href="/feed" style={styles.backLink}>
              ← Back to Feed
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Success state
  if (publishState.status === "success" && publishState.postId) {
    return (
      <main style={styles.main}>
        <div style={styles.container}>
          <div style={styles.successContainer}>
            <div style={styles.successIcon}>✅</div>
            <h2 style={styles.successTitle}>Post Published!</h2>
            <p style={styles.successText}>
              Your post has been successfully published to the blockchain.
            </p>
            <div style={styles.successActions}>
              <Link
                href={`/posts/${publishState.postId}`}
                style={styles.viewPostButton}
              >
                View Post →
              </Link>
              <button
                onClick={() => {
                  setContent("");
                  setPublishState({ status: "idle", errorMsg: "", postId: null });
                }}
                style={styles.createAnotherButton}
              >
                Create Another
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Header */}
        <header style={styles.header}>
          <Link href="/feed" style={styles.backButton}>
            ← Cancel
          </Link>
          <h1 style={styles.title}>New Post</h1>
          <div style={styles.headerSpacer} />
        </header>

        {/* Composer Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Author info */}
          <div style={styles.authorInfo}>
            <div style={styles.avatar}>
              {publicKey ? publicKey.slice(0, 2).toUpperCase() : "??"}
            </div>
            <span style={styles.authorName}>
              {publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : "Unknown"}
            </span>
          </div>

          {/* Textarea */}
          <div style={styles.textareaContainer}>
            <textarea
              value={content}
              onChange={handleContentChange}
              placeholder="What's happening?"
              maxLength={MAX_CONTENT_LENGTH}
              disabled={publishState.status !== "idle"}
              style={{
                ...styles.textarea,
                ...(isOverLimit ? styles.textareaError : {}),
              }}
              autoFocus
            />

            {/* Character counter with progress ring */}
            <div style={styles.counterContainer}>
              <div
                style={{
                  ...styles.counter,
                  ...(isNearLimit ? styles.counterWarning : {}),
                  ...(isOverLimit ? styles.counterError : {}),
                }}
              >
                <span style={styles.counterText}>
                  {charCount}
                  <span style={styles.counterMax}>/{MAX_CONTENT_LENGTH}</span>
                </span>
                {/* Circular progress indicator */}
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

          {/* Transaction fee info */}
          <div style={styles.feeInfo}>
            <span style={styles.feeIcon}>⛽</span>
            <span style={styles.feeText}>
              Estimated network fee: <strong>{TRANSACTION_FEE_ESTIMATE}</strong>
            </span>
          </div>

          {/* Error message */}
          {publishState.status === "error" && (
            <div style={styles.errorContainer}>
              <span style={styles.errorIcon}>⚠️</span>
              <span style={styles.errorText}>{publishState.errorMsg}</span>
              <button
                type="button"
                onClick={handleTryAgain}
                style={styles.tryAgainButton}
              >
                Try Again
              </button>
            </div>
          )}

          {/* Submit button */}
          <div style={styles.footer}>
            <button
              type="submit"
              disabled={isDisabled}
              style={{
                ...styles.publishButton,
                ...(isDisabled ? styles.publishButtonDisabled : {}),
                ...(publishState.status === "awaiting_signature"
                  ? styles.publishButtonSigning
                  : {}),
                ...(publishState.status === "submitting"
                  ? styles.publishButtonSubmitting
                  : {}),
              }}
            >
              {publishState.status === "awaiting_signature" && (
                <>
                  <span style={styles.buttonSpinner}>⏳</span>
                  <span>Approve in Wallet...</span>
                </>
              )}
              {publishState.status === "submitting" && (
                <>
                  <span style={styles.buttonSpinner}>🔄</span>
                  <span>Publishing...</span>
                </>
              )}
              {publishState.status === "idle" && (
                <span>Publish Post</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
    display: "flex",
    justifyContent: "center",
  },
  container: {
    width: "100%",
    maxWidth: "600px",
    background: "var(--color-bg)",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--spacing-md) var(--spacing-lg)",
    borderBottom: "1px solid var(--color-border)",
    position: "sticky",
    top: 0,
    background: "var(--color-bg)",
    zIndex: 10,
  },
  backButton: {
    color: "var(--color-text-secondary)",
    textDecoration: "none",
    fontSize: "0.9rem",
    fontWeight: 500,
    padding: "var(--spacing-sm)",
    borderRadius: "8px",
    transition: "background 0.2s",
  },
  title: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 700,
    textAlign: "center",
    flex: 1,
  },
  headerSpacer: {
    width: "60px",
  },
  form: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: "var(--spacing-lg)",
  },
  authorInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    marginBottom: "var(--spacing-md)",
  },
  avatar: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "var(--color-primary)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
  authorName: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "var(--color-text)",
  },
  textareaContainer: {
    position: "relative",
    flex: 1,
    marginBottom: "var(--spacing-md)",
  },
  textarea: {
    width: "100%",
    minHeight: "200px",
    padding: "var(--spacing-md)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    fontSize: "1.1rem",
    lineHeight: 1.6,
    fontFamily: "inherit",
    resize: "none",
    outline: "none",
    background: "var(--color-bg)",
    color: "var(--color-text)",
  },
  textareaError: {
    borderColor: "var(--color-like)",
    background: "#fef2f2",
  },
  counterContainer: {
    position: "absolute",
    bottom: "var(--spacing-md)",
    right: "var(--spacing-md)",
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
  },
  counter: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
    fontFamily: "monospace",
    position: "relative",
    padding: "4px 8px",
    borderRadius: "8px",
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
  },
  progressRing: {
    width: "24px",
    height: "24px",
    position: "absolute",
    right: "-4px",
    top: "50%",
    transform: "translateY(-50%)",
    pointerEvents: "none",
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
  feeInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "var(--color-bg-secondary)",
    borderRadius: "8px",
    marginBottom: "var(--spacing-md)",
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
  },
  feeIcon: {
    fontSize: "1rem",
  },
  feeText: {
    fontWeight: 400,
  },
  errorContainer: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-md)",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    marginBottom: "var(--spacing-md)",
  },
  errorIcon: {
    fontSize: "1.2rem",
  },
  errorText: {
    flex: 1,
    fontSize: "0.9rem",
    color: "var(--color-like)",
  },
  tryAgainButton: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "transparent",
    border: "1px solid var(--color-like)",
    borderRadius: "6px",
    color: "var(--color-like)",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  footer: {
    marginTop: "auto",
    paddingTop: "var(--spacing-md)",
  },
  publishButton: {
    width: "100%",
    padding: "var(--spacing-md) var(--spacing-lg)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "12px",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--spacing-sm)",
    transition: "all 0.2s",
    minHeight: "48px",
  },
  publishButtonDisabled: {
    background: "var(--color-text-secondary)",
    cursor: "not-allowed",
    opacity: 0.6,
  },
  publishButtonSigning: {
    background: "#f59e0b",
  },
  publishButtonSubmitting: {
    background: "#3b82f6",
  },
  buttonSpinner: {
    fontSize: "1rem",
  },
  // Wallet required state
  walletRequired: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--spacing-xl)",
    textAlign: "center",
  },
  walletIcon: {
    fontSize: "4rem",
    marginBottom: "var(--spacing-lg)",
  },
  walletTitle: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-sm)",
    color: "var(--color-text)",
  },
  walletText: {
    fontSize: "1rem",
    color: "var(--color-text-secondary)",
    marginBottom: "var(--spacing-xl)",
    maxWidth: "300px",
  },
  backLink: {
    color: "var(--color-primary)",
    textDecoration: "none",
    fontWeight: 500,
  },
  // Success state
  successContainer: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--spacing-xl)",
    textAlign: "center",
  },
  successIcon: {
    fontSize: "4rem",
    marginBottom: "var(--spacing-lg)",
  },
  successTitle: {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-sm)",
    color: "var(--color-text)",
  },
  successText: {
    fontSize: "1rem",
    color: "var(--color-text-secondary)",
    marginBottom: "var(--spacing-xl)",
    maxWidth: "300px",
  },
  successActions: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-md)",
    width: "100%",
    maxWidth: "280px",
  },
  viewPostButton: {
    padding: "var(--spacing-md) var(--spacing-lg)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "12px",
    fontSize: "1rem",
    fontWeight: 600,
    textDecoration: "none",
    textAlign: "center",
  },
  createAnotherButton: {
    padding: "var(--spacing-md) var(--spacing-lg)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    color: "var(--color-text)",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

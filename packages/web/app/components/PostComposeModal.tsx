"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";

const MAX_CONTENT_LENGTH = 280;
const WARNING_THRESHOLD = 260;
const TRANSACTION_FEE_ESTIMATE = "0.00001 XLM";

type SubmitStatus = "idle" | "awaiting_signature" | "submitting" | "success" | "error";

interface PostComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (postId: number) => void;
}

interface PublishState {
  status: SubmitStatus;
  errorMsg: string;
  postId: number | null;
}

export function PostComposeModal({
  isOpen,
  onClose,
  onSuccess,
}: PostComposeModalProps) {
  const { publicKey, isConnected } = useWallet();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const progressPercent = Math.min((charCount / MAX_CONTENT_LENGTH) * 100, 100);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && publishState.status === "idle") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose, publishState.status]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

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

      setPublishState({ status: "awaiting_signature", errorMsg: "", postId: null });

      try {
        await new Promise((resolve) => setTimeout(resolve, 800));
        setPublishState((prev) => ({ ...prev, status: "submitting" }));
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const newPostId = Math.floor(Math.random() * 10000) + 1;

        setPublishState({
          status: "success",
          errorMsg: "",
          postId: newPostId,
        });

        if (onSuccess) {
          onSuccess(newPostId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to publish post";
        setPublishState({
          status: "error",
          errorMsg: message,
          postId: null,
        });
      }
    },
    [content, isDisabled, publicKey, onSuccess]
  );

  const handleCloseSuccess = () => {
    if (publishState.postId) {
      onClose();
      router.push(`/posts/${publishState.postId}`);
    }
  };

  const handleTryAgain = () => {
    setPublishState({ status: "idle", errorMsg: "", postId: null });
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && publishState.status === "idle") {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Success state
  if (publishState.status === "success" && publishState.postId) {
    return (
      <div style={styles.overlay} onClick={handleBackdropClick}>
        <div style={styles.modal}>
          <div style={styles.successContainer}>
            <div style={styles.successIcon}>✅</div>
            <h2 style={styles.successTitle}>Post Published!</h2>
            <p style={styles.successText}>
              Your post has been successfully published to the blockchain.
            </p>
            <div style={styles.successActions}>
              <button onClick={handleCloseSuccess} style={styles.viewPostButton}>
                View Post →
              </button>
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
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={handleBackdropClick}>
      <div
        style={{
          ...styles.modal,
          ...(publishState.status === "awaiting_signature" ? styles.modalSigning : {}),
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
      >
        {/* Header */}
        <header style={styles.header}>
          <button
            type="button"
            onClick={onClose}
            disabled={publishState.status !== "idle"}
            style={styles.closeButton}
            aria-label="Close"
          >
            ✕
          </button>
          <h2 id="compose-title" style={styles.modalTitle}>
            New Post
          </h2>
          <button
            type="submit"
            form="compose-form"
            disabled={isDisabled}
            style={{
              ...styles.headerPublishButton,
              ...(isDisabled ? styles.headerPublishButtonDisabled : {}),
            }}
          >
            {publishState.status === "awaiting_signature"
              ? "Signing..."
              : publishState.status === "submitting"
              ? "..."
              : "Publish"}
          </button>
        </header>

        {/* Form */}
        <form id="compose-form" onSubmit={handleSubmit} style={styles.form}>
          {!isConnected ? (
            <div style={styles.walletRequired}>
              <div style={styles.walletIcon}>👛</div>
              <p style={styles.walletText}>
                Connect your wallet to publish posts on-chain.
              </p>
            </div>
          ) : (
            <>
              {/* Author info */}
              <div style={styles.authorInfo}>
                <div style={styles.avatar}>
                  {publicKey ? publicKey.slice(0, 2).toUpperCase() : "??"}
                </div>
                <span style={styles.authorName}>
                  {publicKey
                    ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}`
                    : "Unknown"}
                </span>
              </div>

              {/* Textarea */}
              <div style={styles.textareaContainer}>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={handleContentChange}
                  placeholder="What's happening?"
                  maxLength={MAX_CONTENT_LENGTH}
                  disabled={publishState.status !== "idle"}
                  style={{
                    ...styles.textarea,
                    ...(isOverLimit ? styles.textareaError : {}),
                  }}
                />
              </div>

              {/* Footer with counter and fee */}
              <div style={styles.formFooter}>
                {/* Transaction fee */}
                <div style={styles.feeInfo}>
                  <span style={styles.feeIcon}>⛽</span>
                  <span style={styles.feeText}>~{TRANSACTION_FEE_ESTIMATE}</span>
                </div>

                {/* Character counter */}
                <div style={styles.counterSection}>
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

              {/* Status indicator for signing/submitting */}
              {publishState.status === "awaiting_signature" && (
                <div style={styles.statusContainer}>
                  <span style={styles.statusSpinner}>⏳</span>
                  <span style={styles.statusText}>
                    Waiting for wallet signature...
                  </span>
                  <span style={styles.statusHint}>
                    Please approve the transaction in your wallet
                  </span>
                </div>
              )}

              {publishState.status === "submitting" && (
                <div style={styles.statusContainer}>
                  <span style={styles.statusSpinner}>🔄</span>
                  <span style={styles.statusText}>Publishing to blockchain...</span>
                  <span style={styles.statusHint}>
                    This may take a few seconds
                  </span>
                </div>
              )}
            </>
          )}
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0, 0, 0, 0.6)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "var(--spacing-md)",
  },
  modal: {
    background: "var(--color-bg)",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "550px",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
  },
  modalSigning: {
    border: "2px solid #f59e0b",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--spacing-md) var(--spacing-lg)",
    borderBottom: "1px solid var(--color-border)",
  },
  closeButton: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    fontSize: "1.2rem",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    transition: "background 0.2s",
  },
  modalTitle: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "var(--color-text)",
  },
  headerPublishButton: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "20px",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    minWidth: "80px",
  },
  headerPublishButtonDisabled: {
    background: "var(--color-text-secondary)",
    cursor: "not-allowed",
    opacity: 0.5,
  },
  form: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "auto",
  },
  authorInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-md) var(--spacing-lg)",
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
    flex: 1,
    padding: "0 var(--spacing-lg)",
    minHeight: "150px",
  },
  textarea: {
    width: "100%",
    minHeight: "150px",
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
  formFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "var(--spacing-md) var(--spacing-lg)",
    gap: "var(--spacing-md)",
  },
  feeInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    fontSize: "0.8rem",
    color: "var(--color-text-secondary)",
  },
  feeIcon: {
    fontSize: "0.9rem",
  },
  feeText: {
    fontWeight: 500,
  },
  counterSection: {
    display: "flex",
    alignItems: "center",
  },
  counter: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
    fontFamily: "monospace",
    position: "relative",
    padding: "4px 8px 4px 32px",
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
    width: "20px",
    height: "20px",
    position: "absolute",
    left: "6px",
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
  errorContainer: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    margin: "0 var(--spacing-lg) var(--spacing-md)",
    padding: "var(--spacing-md)",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
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
    whiteSpace: "nowrap",
  },
  statusContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    padding: "var(--spacing-lg)",
    margin: "0 var(--spacing-lg) var(--spacing-lg)",
    background: "var(--color-bg-secondary)",
    borderRadius: "12px",
    textAlign: "center",
  },
  statusSpinner: {
    fontSize: "1.5rem",
    animation: "spin 1s linear infinite",
  },
  statusText: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "var(--color-text)",
  },
  statusHint: {
    fontSize: "0.8rem",
    color: "var(--color-text-secondary)",
  },
  // Wallet required state
  walletRequired: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--spacing-xl)",
    textAlign: "center",
  },
  walletIcon: {
    fontSize: "3rem",
    marginBottom: "var(--spacing-md)",
  },
  walletText: {
    fontSize: "0.95rem",
    color: "var(--color-text-secondary)",
  },
  // Success state
  successContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "var(--spacing-xl)",
    textAlign: "center",
  },
  successIcon: {
    fontSize: "4rem",
    marginBottom: "var(--spacing-md)",
  },
  successTitle: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-sm)",
    color: "var(--color-text)",
  },
  successText: {
    fontSize: "0.95rem",
    color: "var(--color-text-secondary)",
    marginBottom: "var(--spacing-xl)",
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
    border: "none",
    cursor: "pointer",
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

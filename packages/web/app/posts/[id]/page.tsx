"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// In a real app this comes from a wallet context / auth hook.
const MOCK_CURRENT_USER = "";

interface Post {
  id: number;
  author: string;
  username?: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
}

function formatAddress(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTimestamp(ts: number) {
  const date = new Date(ts * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTipTotal(amount: number) {
  return (amount / 10_000_000).toFixed(2);
}

// ── Tip Modal ─────────────────────────────────────────────────────────────────

function TipModal({
  postId,
  authorName,
  onClose,
}: {
  postId: number;
  authorName: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<
    "idle" | "confirming" | "submitting" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleConfirm = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErrorMsg("Enter a valid positive amount.");
      return;
    }
    setErrorMsg("");
    setStatus("confirming");
    setTimeout(() => setStatus("submitting"), 700);
    setTimeout(() => setStatus("success"), 1600);
  };

  return (
    <div style={styles.overlay} role="dialog" aria-modal aria-label="Tip creator">
      <div style={styles.modal}>
        <h2 style={styles.modalTitle}>Tip @{authorName}</h2>
        <p style={styles.modalDesc}>
          Support post #{postId}. A small protocol fee is deducted and the rest
          goes directly to the author.
        </p>

        {status === "success" ? (
          <div style={styles.successBox}>
            <span style={{ fontSize: "2rem" }}>✅</span>
            <p style={{ fontWeight: 600, marginTop: "0.5rem" }}>Tip sent!</p>
          </div>
        ) : (
          <>
            <label htmlFor="tip-amount" style={styles.label}>
              Amount (XLM)
            </label>
            <input
              id="tip-amount"
              type="number"
              min="0.0000001"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={status !== "idle"}
              style={styles.input}
            />
            {errorMsg && <p style={styles.inlineError}>{errorMsg}</p>}

            {status === "confirming" && (
              <p style={styles.statusMsg}>⏳ Check your wallet to approve…</p>
            )}
            {status === "submitting" && (
              <p style={styles.statusMsg}>🔄 Submitting transaction…</p>
            )}

            <div style={styles.modalActions}>
              <button
                onClick={onClose}
                style={styles.cancelBtn}
                disabled={status !== "idle"}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                style={styles.tipBtn}
                disabled={status !== "idle"}
              >
                {status === "idle" ? "Confirm tip" : "Waiting…"}
              </button>
            </div>
          </>
        )}

        {status === "success" && (
          <button onClick={onClose} style={{ ...styles.tipBtn, marginTop: "1rem", width: "100%" }}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// ── Delete confirmation dialog ────────────────────────────────────────────────

function DeleteDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={styles.overlay} role="dialog" aria-modal aria-label="Confirm delete">
      <div style={{ ...styles.modal, maxWidth: "360px" }}>
        <h2 style={styles.modalTitle}>Delete post?</h2>
        <p style={styles.modalDesc}>
          This action cannot be undone. The post will be permanently removed
          from the chain.
        </p>
        <div style={styles.modalActions}>
          <button onClick={onCancel} style={styles.cancelBtn}>
            Keep post
          </button>
          <button onClick={onConfirm} style={styles.deleteConfirmBtn}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PostDetailPage() {
  const params = useParams();
  const postId = Number(params?.id);

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [liking, setLiking] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);

    // Mock data — replace with contract call: get_post(postId) + has_liked(currentUser, postId)
    setTimeout(() => {
      if (!postId || postId < 1) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setPost({
        id: postId,
        author: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF3",
        username: "creator_alice",
        content:
          "Just deployed my first Soroban smart contract! The Stellar network's speed and low fees make it genuinely viable for creator economy applications. If you're building on-chain social, look no further. 🚀\n\nHere's what I learned from the experience…",
        tip_total: 245_000_000,
        timestamp: Date.now() / 1000 - 10_800,
        like_count: 47,
      });
      setLoading(false);
    }, 400);
  }, [postId]);

  const isAuthor =
    MOCK_CURRENT_USER !== "" && post?.author === MOCK_CURRENT_USER;

  const handleLike = useCallback(() => {
    if (liking || !post) return;
    setLiking(true);
    setTimeout(() => {
      setIsLiked((prev) => !prev);
      setPost((p) =>
        p ? { ...p, like_count: p.like_count + (isLiked ? -1 : 1) } : p
      );
      setLiking(false);
    }, 400);
  }, [liking, post, isLiked]);

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const handleDelete = () => {
    // Replace with contract call: delete_post(author, postId)
    setShowDelete(false);
    setDeleted(true);
  };

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.skeleton} />
        <div style={{ ...styles.skeleton, height: "60px" }} />
        <div style={{ ...styles.skeleton, height: "80px" }} />
      </main>
    );
  }

  if (notFound || !post || deleted) {
    return (
      <main style={styles.page}>
        <Link href="/feed" style={styles.backLink}>
          ← Back to feed
        </Link>
        <div style={styles.emptyState}>
          <span style={{ fontSize: "2.5rem" }}>🔍</span>
          <p style={styles.emptyTitle}>Post not found</p>
          <p style={styles.emptyDesc}>
            {deleted
              ? "The post was deleted successfully."
              : "This post may not exist or has been removed."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <Link href="/feed" style={styles.backLink}>
        ← Back to feed
      </Link>

      {/* ── Author card ─────────────────────────────────────────────────── */}
      <div style={styles.authorCard}>
        <div style={styles.avatar} aria-hidden="true" />
        <div style={styles.authorInfo}>
          <Link
            href={`/profile/${post.author}`}
            style={styles.authorName}
          >
            @{post.username || formatAddress(post.author)}
          </Link>
          <code style={styles.authorAddress}>
            {formatAddress(post.author)}
          </code>
        </div>
        {isAuthor && (
          <button
            onClick={() => setShowDelete(true)}
            style={styles.deleteBtn}
            aria-label="Delete post"
          >
            🗑 Delete
          </button>
        )}
      </div>

      {/* ── Post content ─────────────────────────────────────────────────── */}
      <article style={styles.contentCard}>
        <p style={styles.content}>{post.content}</p>
        <time style={styles.timestamp}>{formatTimestamp(post.timestamp)}</time>
      </article>

      {/* ── Engagement metrics ───────────────────────────────────────────── */}
      <div style={styles.metricsRow}>
        <div style={styles.metric}>
          <span style={styles.metricValue}>{post.like_count}</span>
          <span style={styles.metricLabel}>likes</span>
        </div>
        <div style={styles.metric}>
          <span style={styles.metricValue}>
            {formatTipTotal(post.tip_total)} XLM
          </span>
          <span style={styles.metricLabel}>tipped</span>
        </div>
      </div>

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      <div style={styles.actions}>
        <button
          onClick={handleLike}
          disabled={liking}
          style={{
            ...styles.actionBtn,
            ...(isLiked ? styles.likedBtn : {}),
          }}
          aria-label={isLiked ? "Unlike post" : "Like post"}
          aria-pressed={isLiked}
        >
          <span>{isLiked ? "❤️" : "🤍"}</span>
          <span>{isLiked ? "Liked" : "Like"}</span>
        </button>

        <button
          onClick={() => setShowTip(true)}
          style={styles.tipActionBtn}
          aria-label="Tip author"
        >
          <span>💎</span>
          <span>Tip</span>
        </button>

        <button
          onClick={handleShare}
          style={styles.actionBtn}
          aria-label="Share post"
        >
          <span>🔗</span>
          <span>{copied ? "Copied!" : "Share"}</span>
        </button>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showTip && (
        <TipModal
          postId={post.id}
          authorName={post.username || formatAddress(post.author)}
          onClose={() => setShowTip(false)}
        />
      )}
      {showDelete && (
        <DeleteDialog
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: "640px",
    margin: "0 auto",
    padding: "var(--spacing-lg)",
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
  },
  backLink: {
    display: "inline-block",
    marginBottom: "var(--spacing-md)",
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--color-primary)",
    textDecoration: "none",
  },
  authorCard: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-md)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-md) var(--spacing-lg)",
    marginBottom: "var(--spacing-md)",
  },
  avatar: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: "var(--color-bg-secondary)",
    border: "2px solid var(--color-border)",
    flexShrink: 0,
  },
  authorInfo: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  authorName: {
    fontWeight: 700,
    fontSize: "1rem",
    color: "var(--color-text)",
    textDecoration: "none",
  },
  authorAddress: {
    fontSize: "0.75rem",
    color: "var(--color-text-secondary)",
    fontFamily: "monospace",
  },
  deleteBtn: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "#fee2e2",
    color: "#991b1b",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "0.85rem",
    minHeight: "var(--min-touch-target)",
    cursor: "pointer",
    border: "none",
    flexShrink: 0,
  },
  contentCard: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
    marginBottom: "var(--spacing-md)",
  },
  content: {
    fontSize: "1.05rem",
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--color-text)",
    marginBottom: "var(--spacing-md)",
  },
  timestamp: {
    display: "block",
    fontSize: "0.82rem",
    color: "var(--color-text-secondary)",
  },
  metricsRow: {
    display: "flex",
    gap: "var(--spacing-lg)",
    padding: "var(--spacing-md) var(--spacing-lg)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    marginBottom: "var(--spacing-md)",
  },
  metric: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
  },
  metricValue: {
    fontWeight: 700,
    fontSize: "1rem",
    color: "var(--color-text)",
  },
  metricLabel: {
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
  },
  actions: {
    display: "flex",
    gap: "var(--spacing-sm)",
    flexWrap: "wrap",
  },
  actionBtn: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "0.9rem",
    minHeight: "var(--min-touch-target)",
    cursor: "pointer",
    transition: "background 0.15s",
    color: "var(--color-text)",
    flex: 1,
    justifyContent: "center",
  },
  likedBtn: {
    background: "#fee2e2",
    borderColor: "#fca5a5",
    color: "#991b1b",
  },
  tipActionBtn: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-primary)",
    border: "none",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "0.9rem",
    minHeight: "var(--min-touch-target)",
    cursor: "pointer",
    color: "white",
    flex: 1,
    justifyContent: "center",
    transition: "background 0.15s",
  },
  /* ── Modals ─────────────────────────────────────────────────────────────── */
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: "var(--spacing-lg)",
  },
  modal: {
    background: "var(--color-bg)",
    borderRadius: "16px",
    padding: "var(--spacing-lg)",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
  },
  modalTitle: {
    fontSize: "1.15rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-sm)",
    color: "var(--color-text)",
  },
  modalDesc: {
    fontSize: "0.88rem",
    color: "var(--color-text-secondary)",
    marginBottom: "var(--spacing-lg)",
    lineHeight: 1.5,
  },
  label: {
    display: "block",
    fontWeight: 600,
    fontSize: "0.9rem",
    marginBottom: "var(--spacing-xs)",
    color: "var(--color-text)",
  },
  input: {
    width: "100%",
    padding: "var(--spacing-sm) var(--spacing-md)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "1rem",
    minHeight: "var(--min-touch-target)",
    boxSizing: "border-box" as const,
    marginBottom: "var(--spacing-sm)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
  },
  inlineError: {
    fontSize: "0.82rem",
    color: "#ef4444",
    marginBottom: "var(--spacing-sm)",
  },
  statusMsg: {
    fontSize: "0.88rem",
    color: "var(--color-text-secondary)",
    marginBottom: "var(--spacing-sm)",
  },
  successBox: {
    textAlign: "center" as const,
    padding: "var(--spacing-lg) 0",
  },
  modalActions: {
    display: "flex",
    gap: "var(--spacing-md)",
    marginTop: "var(--spacing-md)",
    justifyContent: "flex-end",
  },
  cancelBtn: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-bg-secondary)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontWeight: 600,
    minHeight: "var(--min-touch-target)",
    cursor: "pointer",
    color: "var(--color-text)",
  },
  tipBtn: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-primary)",
    border: "none",
    borderRadius: "8px",
    fontWeight: 600,
    minHeight: "var(--min-touch-target)",
    cursor: "pointer",
    color: "white",
  },
  deleteConfirmBtn: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "#ef4444",
    border: "none",
    borderRadius: "8px",
    fontWeight: 600,
    minHeight: "var(--min-touch-target)",
    cursor: "pointer",
    color: "white",
  },
  /* ── Skeleton / empty ─────────────────────────────────────────────────── */
  skeleton: {
    height: "120px",
    borderRadius: "12px",
    background: "var(--color-bg-secondary)",
    marginBottom: "var(--spacing-md)",
  },
  emptyState: {
    textAlign: "center" as const,
    padding: "var(--spacing-xl)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
  },
  emptyTitle: {
    fontWeight: 600,
    fontSize: "1.1rem",
    marginBottom: "var(--spacing-sm)",
    marginTop: "var(--spacing-sm)",
  },
  emptyDesc: {
    color: "var(--color-text-secondary)",
    fontSize: "0.9rem",
  },
};

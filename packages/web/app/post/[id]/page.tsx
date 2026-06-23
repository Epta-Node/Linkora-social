"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useWallet } from "../../components/WalletProvider";
import { useNotification } from "../../context/NotificationContext";
import { normalizeError } from "../../lib/normalizeError";
import { TipModal } from "../../components/TipModal";

interface Post {
  id: number;
  author: string;
  username?: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
}

async function getPost(id: number): Promise<Post | null> {
  // Mock for now: replace with contract call get_post(id).
  await new Promise((resolve) => setTimeout(resolve, 450));

  if (!id || id < 1) {
    return null;
  }

  return {
    id,
    author: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF3",
    username: "creator_alice",
    content:
      "Just deployed my first Soroban smart contract! The Stellar network's speed and low fees make it genuinely viable for creator economy applications. If you're building on-chain social, look no further. 🚀\n\nHere's what I learned from the experience…",
    tip_total: 245_000_000,
    timestamp: Math.floor(Date.now() / 1000) - 10800,
    like_count: 47,
  };
}

export default function PostPage() {
  const params = useParams();
  const postId = Number(params?.id);
  const { publicKey, isConnected } = useWallet();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [hasLiked, setHasLiked] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [tipToken, setTipToken] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [isTipping, setIsTipping] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setNotFound(false);
    setDeleted(false);

    getPost(postId)
      .then((result) => {
        if (!mounted) return;
        if (!result) {
          setNotFound(true);
          return;
        }
        setPost(result);
      })
      .catch(() => {
        if (!mounted) return;
        setNotFound(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [postId]);

  const handleLike = useCallback(async () => {
    if (!isConnected || isLiking || !post) return;
    setIsLiking(true);

    const { addNotification, updateNotification } = useNotification();
    const id = addNotification({ status: 'pending', message: 'Waiting for signature...' });
    try {
      await new Promise((resolve) => setTimeout(resolve, 650));
      // Mock tx hash for demo purposes
      const txHash = `mocktx_${Date.now().toString(36)}`;
      setHasLiked((prev) => !prev);
      setPost((prev) =>
        prev
          ? { ...prev, like_count: prev.like_count + (hasLiked ? -1 : 1) }
          : prev
      );
      updateNotification(id, { status: 'success', message: 'Transaction confirmed', txHash });
    } catch (err) {
      updateNotification(id, { status: 'error', message: normalizeError(err) });
    } finally {
      setIsLiking(false);
    }
  }, [isConnected, isLiking, hasLiked, post]);

  const handleTip = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isConnected) return;

      const amount = Number(tipAmount);
      if (!tipToken || amount <= 0) {
        setTipError("Please enter a valid token address and positive amount");
        return;
      }

      setIsTipping(true);
      setTipError(null);
      const { addNotification, updateNotification } = useNotification();
      const id = addNotification({ status: 'pending', message: 'Waiting for signature...' });
      try {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        // Mock tx hash for demo purposes
        const txHash = `mocktx_${Date.now().toString(36)}`;
        setPost((prev) =>
          prev
            ? { ...prev, tip_total: prev.tip_total + amount * 10_000_000 }
            : prev
        );
        setTipToken("");
        setTipAmount("");
        updateNotification(id, { status: 'success', message: 'Transaction confirmed', txHash });
      } catch (err) {
        setTipError(err instanceof Error ? err.message : "Failed to tip post");
        updateNotification(id, { status: 'error', message: normalizeError(err) });
      } finally {
        setIsTipping(false);
      }
    },
    [isConnected, tipAmount, tipToken]
  );

  const handleDelete = useCallback(() => {
    if (!window.confirm("Delete this post? This action cannot be undone.")) {
      return;
    }
    setDeleted(true);
  }, []);

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return date.toLocaleString();
  };

  const formatTipTotal = (amount: number) => (amount / 10_000_000).toFixed(2);

  if (loading) {
    return (
      <main style={styles.main}>
        <div style={styles.loading}>Loading post...</div>
      </main>
    );
  }

  if (notFound || deleted || !post) {
    return (
      <main style={styles.main}>
        <div style={styles.notFound}>
          <h1>Post not found</h1>
          <p>
            {deleted
              ? "This post was deleted successfully."
              : "The post you are looking for is missing or has been removed."}
          </p>
          <Link href="/feed" style={styles.backLink}>
            Back to Feed
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <article style={styles.card}>
        <Link href="/feed" style={styles.backLink}>
          ← Back to Feed
        </Link>

        <div style={styles.header}>
          <div style={styles.avatar}></div>
          <div style={styles.authorInfo}>
            <Link href={`/profile/${post.author}`} style={styles.username}>
              {post.username || formatAddress(post.author)}
            </Link>
            <div style={styles.timestamp}>{formatTimestamp(post.timestamp)}</div>
          </div>
        </div>

        <div style={styles.content}>{post.content}</div>

        <div style={styles.stats}>
          <div style={styles.stat}>
            <span>❤️</span>
            <span>{post.like_count}</span>
          </div>
          <div style={styles.stat}>
            <span>💎</span>
            <span>{formatTipTotal(post.tip_total)} XLM</span>
          </div>
        </div>

        <div style={styles.actions}>
          {isConnected ? (
            <button
              onClick={handleLike}
              disabled={isLiking}
              style={{
                ...styles.actionButton,
                ...(hasLiked ? styles.likedButton : {}),
              }}
            >
              {hasLiked ? "❤️ Liked" : "🤍 Like"}
            </button>
          ) : (
            <p style={styles.readOnlyText}>Connect wallet to like</p>
          )}

          <button
            onClick={() => setShowTipModal(true)}
            style={styles.actionButton}
            disabled={!isConnected}
          >
            💎 Tip
          </button>

          {isConnected && publicKey === post.author && (
            <button onClick={handleDelete} style={styles.deleteButton}>
              🗑 Delete
            </button>
          )}
        </div>

        {isConnected && (
          <form onSubmit={handleTip} style={styles.tipForm}>
            <h3 style={styles.tipTitle}>Tip the author</h3>
            <div style={styles.tipInputs}>
              <input
                type="text"
                value={tipToken}
                onChange={(e) => setTipToken(e.target.value)}
                placeholder="Token address (e.g., G...)"
                style={styles.input}
                disabled={isTipping}
              />
              <input
                type="number"
                value={tipAmount}
                onChange={(e) => setTipAmount(e.target.value)}
                placeholder="Amount"
                min="1"
                step="1"
                style={styles.input}
                disabled={isTipping}
              />
            </div>
            {tipError && <p style={styles.error}>{tipError}</p>}
            <button
              type="submit"
              disabled={isTipping || !tipToken || !tipAmount}
              style={{
                ...styles.tipButton,
                ...(isTipping || !tipToken || !tipAmount ? styles.tipButtonDisabled : {}),
              }}
            >
              {isTipping ? "Sending..." : "Send Tip"}
            </button>
          </form>
        )}
      </article>

      {showTipModal && (
        <TipModal
          postId={post.id}
          authorName={post.username || formatAddress(post.author)}
          onClose={() => setShowTipModal(false)}
        />
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
    padding: "var(--spacing-lg)",
  },
  loading: {
    textAlign: "center",
    padding: "var(--spacing-xl)",
    color: "var(--color-text-secondary)",
  },
  notFound: {
    textAlign: "center",
    padding: "var(--spacing-xl)",
    maxWidth: "400px",
    margin: "0 auto",
  },
  backLink: {
    display: "inline-block",
    marginBottom: "var(--spacing-lg)",
    color: "var(--color-primary)",
    fontWeight: 500,
  },
  card: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-xl)",
    maxWidth: "600px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-md)",
    marginBottom: "var(--spacing-lg)",
  },
  avatar: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: "var(--color-bg-secondary)",
  },
  authorInfo: {
    flex: 1,
  },
  username: {
    fontWeight: 600,
    fontSize: "1.1rem",
    color: "var(--color-text)",
  },
  timestamp: {
    fontSize: "0.9rem",
    color: "var(--color-text-secondary)",
  },
  content: {
    fontSize: "1.1rem",
    lineHeight: 1.6,
    marginBottom: "var(--spacing-lg)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  stats: {
    display: "flex",
    gap: "var(--spacing-lg)",
    padding: "var(--spacing-md) 0",
    borderTop: "1px solid var(--color-border)",
    borderBottom: "1px solid var(--color-border)",
    marginBottom: "var(--spacing-lg)",
  },
  stat: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
    fontSize: "1rem",
  },
  actions: {
    display: "flex",
    gap: "var(--spacing-md)",
    marginBottom: "var(--spacing-lg)",
  },
  actionButton: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-bg-secondary)",
    borderRadius: "8px",
    fontWeight: 500,
    transition: "all 0.2s",
    border: "1px solid var(--color-border)",
  },
  likedButton: {
    background: "#fee2e2",
  },
  deleteButton: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "#fecaca",
    borderRadius: "8px",
    color: "#991b1b",
    fontWeight: 500,
    border: "1px solid #fca5a5",
    cursor: "pointer",
  },
  readOnlyText: {
    color: "var(--color-text-secondary)",
  },
  tipForm: {
    background: "var(--color-bg-secondary)",
    borderRadius: "8px",
    padding: "var(--spacing-lg)",
  },
  tipTitle: {
    marginBottom: "var(--spacing-md)",
    fontSize: "1rem",
  },
  tipInputs: {
    display: "flex",
    gap: "var(--spacing-sm)",
    marginBottom: "var(--spacing-md)",
  },
  input: {
    flex: 1,
    padding: "var(--spacing-sm) var(--spacing-md)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "0.95rem",
  },
  error: {
    color: "var(--color-like)",
    fontSize: "0.85rem",
    marginBottom: "var(--spacing-sm)",
  },
  tipButton: {
    width: "100%",
    padding: "var(--spacing-md)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
  },
  tipButtonDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
};

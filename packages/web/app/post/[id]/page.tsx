"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "../../components/WalletProvider";

interface Post {
  id: number;
  author: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
  username?: string;
}

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const postId = Number(params.id);

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

  useEffect(() => {
    setLoading(true);
    setNotFound(false);

    setTimeout(() => {
      if (postId <= 0) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setPost({
        id: postId,
        author: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        content: "This is a sample post content loaded from the blockchain. It demonstrates how the post detail page displays all the information including the author, timestamp, likes, and tips.",
        tip_total: 50000000,
        timestamp: Date.now() / 1000 - 3600,
        like_count: 12,
        username: "sample_user",
      });
      setLoading(false);
    }, 500);
  }, [postId]);

  const handleLike = useCallback(async () => {
    if (!isConnected || isLiking) return;
    setIsLiking(true);

    try {
      console.log("Liking post:", postId, "with publicKey:", publicKey);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setHasLiked((prev) => !prev);
      setPost((prev) =>
        prev ? { ...prev, like_count: prev.like_count + (hasLiked ? -1 : 1) } : prev,
      );
    } catch (err) {
      console.error("Failed to like post:", err);
    } finally {
      setIsLiking(false);
    }
  }, [isConnected, isLiking, postId, publicKey, hasLiked]);

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

      try {
        console.log("Tipping post:", postId, "with amount:", amount, "token:", tipToken);
        await new Promise((resolve) => setTimeout(resolve, 1500));

        setPost((prev) =>
          prev
            ? {
                ...prev,
                tip_total: prev.tip_total + amount * 10_000_000,
              }
            : prev,
        );

        setTipToken("");
        setTipAmount("");
      } catch (err) {
        setTipError(err instanceof Error ? err.message : "Failed to tip post");
      } finally {
        setIsTipping(false);
      }
    },
    [isConnected, tipToken, tipAmount, postId],
  );

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return date.toLocaleString();
  };

  const formatTipTotal = (amount: number) => {
    return (amount / 10_000_000).toFixed(2);
  };

  if (loading) {
    return (
      <main style={styles.main}>
        <div style={styles.loading}>Loading...</div>
      </main>
    );
  }

  if (notFound || !post) {
    return (
      <main style={styles.main}>
        <div style={styles.notFound}>
          <h1>Post not found</h1>
          <p>The post you are looking for doesn&apos;t exist or has been removed.</p>
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
            <Link
              href={`/profile/${post.author}`}
              style={styles.username}
            >
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
              {hasLiked ? "❤️ Liked" : "🤍 Like"} ({post.like_count})
            </button>
          ) : (
            <p style={styles.readOnlyText}> Connect wallet to like</p>
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
                placeholder="Token address (e.g., G..."
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
                ...(isTipping || !tipToken || !tipAmount
                  ? styles.tipButtonDisabled
                  : {}),
              }}
            >
              {isTipping ? "Sending..." : "Send Tip"}
            </button>
          </form>
        )}
      </article>
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
  },
  likedButton: {
    background: "#fee2e2",
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